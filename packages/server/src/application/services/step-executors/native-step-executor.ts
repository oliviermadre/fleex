import { NATIVE_FOR_EACH_MAX_ITEMS } from '@fleex/shared';
import type {
  ApplyNativeActionsUseCase,
  ApplyNativeActionsResult,
  ApplyNativeActionsInput,
} from '../../use-cases/apply-native-actions.js';
import { NativeActionsPartialFailure } from '../../use-cases/apply-native-actions.js';
import {
  resolveValue,
  type RuntimeReferenceContext,
} from '../native-operations/resolve-references.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';

/**
 * Runs a `native` step: a deterministic list of ticket operations, no LLM.
 *
 * Like `HumanGateStepExecutor` it resolves synchronously, never calls
 * `onExecutionStarted` and returns no `executionId` — so no agent execution row
 * is created and no tokens are spent.
 *
 * With a `forEach`, the same action list runs once per element of an upstream
 * array. The loop lives *here* and not inside `applyNativeActions` on purpose:
 * that use-case owns an atomicity contract (resolve and validate everything,
 * then one read and one write, then the effects) which only holds for a single
 * pass. One iteration = one full `execute()` call keeps that contract intact and
 * makes a failed element a failed element, not a half-applied step.
 */
export class NativeStepExecutor implements StepExecutor {
  constructor(private readonly applyNativeActions: ApplyNativeActionsUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const actions = input.step.nativeActions ?? [];
    if (actions.length === 0) {
      throw new Error(`native step ${input.step.id}: must have at least one action`);
    }

    // No ticket is no longer fatal: a routine run can still create tickets and
    // trigger workflows. `applyNativeActions` refuses, by name, the operations
    // that genuinely need a subject.
    const base: Omit<ApplyNativeActionsInput, 'references'> = {
      ticketId: input.ticketId,
      subjectBoardId: input.subject?.boardId ?? null,
      workflowRunId: input.workflowRunId,
      stepName: input.step.name || input.step.id,
      actions,
      workflowName: input.workflowContext.workflowName,
    };
    const references = {
      steps: input.workflowContext.previousOutputs,
      predecessorStepIds: input.workflowContext.predecessorStepIds ?? [],
    };

    if (input.step.forEach) {
      return this.executeFanOut(input, base, references);
    }

    try {
      const result = await this.applyNativeActions.execute({ ...base, references });
      return { output: { schemaFields: fields(result), result: 'ok' } };
    } catch (err) {
      // A misconfigured or unresolvable action is a step failure, not a crash:
      // surface the reason in schemaFields so the run view can show it, and let
      // the engine mark the run failed through the normal `ko` path.
      const message = err instanceof Error ? err.message : String(err);
      // When the failure came after a write had already committed, report what
      // landed rather than a flat zero — a downstream step correcting the
      // failure needs to know the ticket was in fact touched.
      const committed = err instanceof NativeActionsPartialFailure
        ? fields(err.committed)
        : { ticketId: input.ticketId, actionsApplied: 0, changed: [], changedFields: '' };

      return { output: { schemaFields: { ...committed, error: message }, result: 'ko' } };
    }
  }

  /**
   * One `execute()` per element, sequentially.
   *
   * Sequential rather than parallel because the iterations share a subject (and,
   * without a `ticket.create`, the very same ticket): running them concurrently
   * would race two read-modify-writes on one row and lose one of them.
   */
  private async executeFanOut(
    input: StepExecutionInput,
    base: Omit<ApplyNativeActionsInput, 'references'>,
    references: { steps: Record<string, Record<string, unknown>>; predecessorStepIds: string[] },
  ): Promise<StepExecutorResult> {
    let items: unknown;
    try {
      items = resolveForEach(input);
    } catch (err) {
      return fanOutFailure(err instanceof Error ? err.message : String(err));
    }

    if (!Array.isArray(items)) {
      return fanOutFailure(
        `native step ${input.step.id}: forEach "${input.step.forEach}" resolved to `
        + `${items === null ? 'null' : typeof items}, but only an array can be iterated`,
      );
    }
    if (items.length > NATIVE_FOR_EACH_MAX_ITEMS) {
      // Refused, never truncated: an upstream agent decides this length, and
      // "we quietly did the first 50 of your 900" is a worse outcome than a
      // step an author can look at and re-run.
      return fanOutFailure(
        `native step ${input.step.id}: forEach produced ${items.length} items, over the `
        + `limit of ${NATIVE_FOR_EACH_MAX_ITEMS} — narrow the upstream step's output`,
      );
    }

    const createdTicketIds: string[] = [];
    const triggeredRunIds: string[] = [];
    const failures: { index: number; error: string }[] = [];

    for (const [index, item] of items.entries()) {
      try {
        const result = await this.applyNativeActions.execute({
          ...base,
          references: { ...references, item },
        });
        if (result.createdTicketId) createdTicketIds.push(result.createdTicketId);
        triggeredRunIds.push(...(result.triggeredRunIds ?? []));
      } catch (err) {
        // One bad element must not cost the good ones: the loop carries on and
        // the step reports which indexes failed.
        const committed = err instanceof NativeActionsPartialFailure ? err.committed : null;
        if (committed?.createdTicketId) createdTicketIds.push(committed.createdTicketId);
        triggeredRunIds.push(...(committed?.triggeredRunIds ?? []));
        failures.push({ index, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      output: {
        schemaFields: {
          iterations: items.length,
          createdTicketIds,
          triggeredRunIds,
          failures,
        },
        // Not `ko`: some elements did land, so the run must not be declared a
        // failure and rolled into a retry. Which of the survivors to keep and
        // what to do with the rest is a human call, so the run stops for one.
        result: failures.length > 0 ? 'needs_review' : 'ok',
      },
    };
  }
}

/**
 * `forEach` is a `{{ … }}` reference like any parameter, resolved against the
 * same upstream outputs — so `{{ steps.<id>.items }}` and `{{ output.items }}`
 * mean here exactly what they mean inside an action.
 */
function resolveForEach(input: StepExecutionInput): unknown {
  const ctx: RuntimeReferenceContext = {
    steps: input.workflowContext.previousOutputs,
    // No ticket and no item: `forEach` may only read an upstream step's output,
    // and anything else must fail rather than iterate a surprise.
    ticket: null,
    workflowName: input.workflowContext.workflowName,
    predecessorStepIds: input.workflowContext.predecessorStepIds ?? [],
  };
  return resolveValue(input.step.forEach, ctx);
}

function fanOutFailure(message: string): StepExecutorResult {
  return {
    output: {
      schemaFields: {
        iterations: 0, createdTicketIds: [], triggeredRunIds: [], failures: [],
        error: message,
      },
      result: 'ko',
    },
  };
}

function fields(result: ApplyNativeActionsResult): Record<string, unknown> {
  return {
    ticketId: result.ticketId,
    actionsApplied: result.actionsApplied,
    changed: result.changed,
    // `EdgeEvaluator`'s `contains` only operates on strings, so the same
    // information is also published in a joined form for routing. Always
    // present — including on the failure path — so an edge conditioned on it
    // compares against `''` rather than `undefined`.
    changedFields: result.changed.join(','),
    ...(result.createdTicketId ? { createdTicketId: result.createdTicketId } : {}),
    ...(result.createdTicketDisplayId !== undefined
      ? { createdTicketDisplayId: result.createdTicketDisplayId }
      : {}),
    ...(result.triggeredRunIds?.length ? { triggeredRunIds: result.triggeredRunIds } : {}),
  };
}
