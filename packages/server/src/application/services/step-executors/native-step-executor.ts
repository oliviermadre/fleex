import type {
  ApplyNativeActionsUseCase,
  ApplyNativeActionsResult,
} from '../../use-cases/apply-native-actions.js';
import { NativeActionsPartialFailure } from '../../use-cases/apply-native-actions.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';

/**
 * Runs a `native` step: a deterministic list of ticket operations, no LLM.
 *
 * Like `HumanGateStepExecutor` it resolves synchronously, never calls
 * `onExecutionStarted` and returns no `executionId` — so no agent execution row
 * is created and no tokens are spent.
 */
export class NativeStepExecutor implements StepExecutor {
  constructor(private readonly applyNativeActions: ApplyNativeActionsUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const actions = input.step.nativeActions ?? [];
    if (actions.length === 0) {
      throw new Error(`native step ${input.step.id}: must have at least one action`);
    }

    try {
      const result = await this.applyNativeActions.execute({
        ticketId: input.ticketId,
        actions,
        workflowName: input.workflowContext.workflowName,
        references: {
          steps: input.workflowContext.previousOutputs,
          predecessorStepIds: input.workflowContext.predecessorStepIds ?? [],
        },
      });

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
  };
}
