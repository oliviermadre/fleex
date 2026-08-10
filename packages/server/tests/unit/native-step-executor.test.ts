import { describe, it, expect, vi } from 'vitest';
import type { NativeAction } from '@fleex/shared';
import { NativeStepExecutor } from '../../src/application/services/step-executors/native-step-executor.js';
import { NativeActionsPartialFailure } from '../../src/application/use-cases/apply-native-actions.js';

const makeInput = (overrides: Partial<{
  actions: NativeAction[];
  previousOutputs: Record<string, Record<string, unknown>>;
  predecessorStepIds: string[];
}> = {}) => ({
  ticketId: 't-1', workflowRunId: 'run-1', stepRunId: 'sr-1',
  step: {
    id: 'native-1', name: 'Triage', executorType: 'native' as const,
    executorRef: 'ticket.actions', position: { x: 0, y: 0 },
    nativeActions: overrides.actions ?? [
      { id: 'a1', operationId: 'ticket.set_status', params: { status: 'doing' } },
    ],
  },
  workflowContext: {
    workflowName: 'Triage flow', stepName: 'Triage', outgoingEdges: [],
    previousOutputs: overrides.previousOutputs ?? {},
    predecessorStepIds: overrides.predecessorStepIds ?? [],
  },
});

const okResult = {
  ticketId: 't-1', actionsApplied: 2, changed: ['status', 'priority'],
};

describe('NativeStepExecutor', () => {
  it('runs without an agent: no execution id, no onExecutionStarted callback', async () => {
    // A native step must not create an agent execution row or spend tokens —
    // that is the entire reason it exists next to the `agent` executor.
    const applyNativeActions = { execute: vi.fn().mockResolvedValue(okResult) };
    const onExecutionStarted = vi.fn();
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const result = await exec.execute({ ...makeInput(), onExecutionStarted } as never);

    expect(result.executionId).toBeUndefined();
    expect(onExecutionStarted).not.toHaveBeenCalled();
  });

  it('forwards the run context needed to resolve references', async () => {
    const applyNativeActions = { execute: vi.fn().mockResolvedValue(okResult) };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    await exec.execute(makeInput({
      previousOutputs: { qualify: { priority: 'high' } },
      predecessorStepIds: ['qualify'],
    }) as never);

    expect(applyNativeActions.execute).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 't-1',
      workflowName: 'Triage flow',
      references: { steps: { qualify: { priority: 'high' } }, predecessorStepIds: ['qualify'] },
    }));
  });

  it('publishes the changed fields as a string too, so edges can route on them', async () => {
    // `EdgeEvaluator`'s `contains` operator only handles strings; without the
    // joined form, a conditional edge on "did the status change?" is impossible.
    const applyNativeActions = { execute: vi.fn().mockResolvedValue(okResult) };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const result = await exec.execute(makeInput() as never);
    const fields = result.output.schemaFields as Record<string, unknown>;

    expect(result.output.result).toBe('ok');
    expect(fields.changed).toEqual(['status', 'priority']);
    expect(fields.changedFields).toBe('status,priority');
    expect(fields.actionsApplied).toBe(2);
  });

  it('exposes the created ticket so a downstream step can act on it', async () => {
    const applyNativeActions = {
      execute: vi.fn().mockResolvedValue({
        ...okResult, ticketId: 't-new', createdTicketId: 't-new', createdTicketDisplayId: 12,
      }),
    };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const fields = (await exec.execute(makeInput() as never)).output.schemaFields as Record<string, unknown>;
    expect(fields.createdTicketId).toBe('t-new');
    expect(fields.createdTicketDisplayId).toBe(12);
  });

  it('omits the created-ticket fields when nothing was created', async () => {
    const applyNativeActions = { execute: vi.fn().mockResolvedValue(okResult) };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const fields = (await exec.execute(makeInput() as never)).output.schemaFields as Record<string, unknown>;
    expect(fields).not.toHaveProperty('createdTicketId');
  });

  it('turns a failure into a ko result carrying the reason, not an exception', async () => {
    // Returning `ko` lets the author route the failure through a conditional
    // edge; throwing would collapse the whole run with no branch to take.
    const applyNativeActions = {
      execute: vi.fn().mockRejectedValue(new Error('{{ steps.ghost.x }} — step "ghost" has not completed')),
    };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const result = await exec.execute(makeInput() as never);
    const fields = result.output.schemaFields as Record<string, unknown>;

    expect(result.output.result).toBe('ko');
    expect(fields.error).toMatch(/has not completed/);
    expect(fields.actionsApplied).toBe(0);
  });

  it('still publishes changedFields when it fails, so an edge can route on it', async () => {
    // `EdgeEvaluator`'s `contains` needs a string; leaving the field out would
    // make a failure branch compare against `undefined` instead of "".
    const applyNativeActions = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const fields = (await exec.execute(makeInput() as never)).output.schemaFields as Record<string, unknown>;
    expect(fields.changedFields).toBe('');
  });

  it('reports the mutation that already committed when a later action fails', async () => {
    // The step is only atomic up to its single write. When an effect fails
    // afterwards, saying "0 applied" would hide a ticket that really was
    // changed — a downstream recovery branch would then act on a false premise.
    const applyNativeActions = {
      execute: vi.fn().mockRejectedValue(new NativeActionsPartialFailure('comment backend down', {
        ticketId: 't-1', actionsApplied: 1, changed: ['status'],
      })),
    };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const result = await exec.execute(makeInput() as never);
    const fields = result.output.schemaFields as Record<string, unknown>;

    expect(result.output.result).toBe('ko');
    expect(fields.actionsApplied).toBe(1);
    expect(fields.changed).toEqual(['status']);
    expect(fields.changedFields).toBe('status');
    expect(fields.error).toMatch(/comment backend down/);
  });

  it('rejects a step with no action rather than reporting a successful no-op', async () => {
    const applyNativeActions = { execute: vi.fn() };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    await expect(exec.execute(makeInput({ actions: [] }) as never))
      .rejects.toThrow(/at least one action/);
    expect(applyNativeActions.execute).not.toHaveBeenCalled();
  });

  it('runs native actions on a routine run instead of refusing outright', async () => {
    // A routine run has no ticket, but it can still create one and trigger a
    // workflow on it. Refusing here would make the whole fan-out feature
    // unreachable from a routine — which is the main place it is wanted.
    const applyNativeActions = { execute: vi.fn().mockResolvedValue({ ...okResult, ticketId: null }) };
    const exec = new NativeStepExecutor(applyNativeActions as never);

    const result = await exec.execute({
      ...makeInput(), ticketId: null, subject: { repos: [], boardId: 'b-routine' },
    } as never);

    expect(result.output.result).toBe('ok');
    // The routine's board travels with the call: it is the only board a
    // `ticket.create` can fall back to when there is no subject ticket.
    expect(applyNativeActions.execute).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: null, subjectBoardId: 'b-routine' }),
    );
  });

  describe('forEach fan-out', () => {
    const fanOut = (
      forEach: string,
      previousOutputs: Record<string, Record<string, unknown>>,
    ) => {
      const input = makeInput({ previousOutputs }) as Record<string, unknown>;
      return { ...input, step: { ...(input.step as object), forEach } };
    };

    it('runs the action list once per element, binding the element to {{ item }}', async () => {
      // The point of Lot 2: one upstream step emits N findings, one native step
      // acts on each — without N copies of the same node in the graph.
      const applyNativeActions = {
        execute: vi.fn(async () => ({ ticketId: 't-new', actionsApplied: 1, changed: [], createdTicketId: 't-new' })),
      };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      const result = await exec.execute(fanOut(
        '{{ steps.scan.findings }}',
        { scan: { findings: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] } },
      ) as never);

      expect(applyNativeActions.execute).toHaveBeenCalledTimes(3);
      expect(applyNativeActions.execute.mock.calls.map(([c]) => (c as {
        references: { item: unknown };
      }).references.item)).toEqual([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);

      const fields = result.output.schemaFields as Record<string, unknown>;
      expect(result.output.result).toBe('ok');
      expect(fields.iterations).toBe(3);
      expect(fields.createdTicketIds).toEqual(['t-new', 't-new', 't-new']);
      expect(fields.failures).toEqual([]);
    });

    it('separates created from found tickets, so a re-poll reads as convergence', async () => {
      // A fan-out of `ticket.upsert` over an already-imported list must report
      // "found, nothing new" — not pretend nothing happened, and not claim
      // creations that never took place.
      const applyNativeActions = {
        execute: vi.fn()
          .mockResolvedValueOnce({ ticketId: 't-new', actionsApplied: 1, changed: [], createdTicketId: 't-new', wasCreated: true })
          .mockResolvedValueOnce({ ticketId: 't-old', actionsApplied: 1, changed: [], wasCreated: false }),
      };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      const result = await exec.execute(
        fanOut('{{ steps.scan.items }}', { scan: { items: ['a', 'b'] } }) as never,
      );
      const fields = result.output.schemaFields as Record<string, unknown>;

      expect(result.output.result).toBe('ok');
      expect(fields.createdTicketIds).toEqual(['t-new']);
      expect(fields.foundTicketIds).toEqual(['t-old']);
    });

    it('keeps each iteration a separate call, so the one-write contract still holds', async () => {
      // Folding the loop into `applyNativeActions` would break its "resolve
      // everything, then one read and one write" guarantee: a failure in the
      // middle would leave some elements half-applied with no way to say which.
      const applyNativeActions = {
        execute: vi.fn(async () => ({ ticketId: 't-1', actionsApplied: 1, changed: [] })),
      };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      await exec.execute(fanOut('{{ steps.scan.items }}', { scan: { items: ['x', 'y'] } }) as never);

      for (const [call] of applyNativeActions.execute.mock.calls) {
        expect((call as { actions: unknown[] }).actions).toHaveLength(1);
      }
    });

    it('fails the step when forEach does not resolve to an array', async () => {
      // Iterating a string character by character, or an object not at all, is
      // never what the author meant — and it would show up as N absurd tickets.
      const applyNativeActions = { execute: vi.fn() };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      const result = await exec.execute(
        fanOut('{{ steps.scan.summary }}', { scan: { summary: 'nothing found' } }) as never,
      );

      expect(result.output.result).toBe('ko');
      expect((result.output.schemaFields as Record<string, unknown>).error)
        .toMatch(/only an array can be iterated/);
      expect(applyNativeActions.execute).not.toHaveBeenCalled();
    });

    it('fails the step when forEach points at a step that never ran', async () => {
      const applyNativeActions = { execute: vi.fn() };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      const result = await exec.execute(fanOut('{{ steps.ghost.items }}', {}) as never);

      expect(result.output.result).toBe('ko');
      expect((result.output.schemaFields as Record<string, unknown>).error).toMatch(/ghost/);
    });

    it('refuses a runaway fan-out instead of silently doing the first 50', async () => {
      // The array length is decided by an upstream agent. Truncating would be
      // the worst outcome: 50 tickets created, 900 asked for, and nothing in the
      // run to say the other 850 were dropped.
      const applyNativeActions = { execute: vi.fn() };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      const result = await exec.execute(fanOut(
        '{{ steps.scan.items }}',
        { scan: { items: Array.from({ length: 51 }, (_, i) => i) } },
      ) as never);

      expect(result.output.result).toBe('ko');
      expect((result.output.schemaFields as Record<string, unknown>).error).toMatch(/over the limit of 50/);
      expect(applyNativeActions.execute).not.toHaveBeenCalled();
    });

    it('reports a partial fan-out as needs_review, not as a failed step', async () => {
      // Some elements landed and some did not. `ko` would invite a retry that
      // re-creates the successful ones; the decision belongs to a human.
      const applyNativeActions = {
        execute: vi.fn()
          .mockResolvedValueOnce({ ticketId: 't-a', actionsApplied: 1, changed: [], createdTicketId: 't-a' })
          .mockRejectedValueOnce(new Error('board b-9 does not exist'))
          .mockResolvedValueOnce({ ticketId: 't-c', actionsApplied: 1, changed: [], createdTicketId: 't-c' }),
      };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      const result = await exec.execute(
        fanOut('{{ steps.scan.items }}', { scan: { items: ['a', 'b', 'c'] } }) as never,
      );
      const fields = result.output.schemaFields as Record<string, unknown>;

      expect(result.output.result).toBe('needs_review');
      // The good elements are not sacrificed to the bad one.
      expect(fields.createdTicketIds).toEqual(['t-a', 't-c']);
      expect(fields.failures).toEqual([{ index: 1, error: 'board b-9 does not exist' }]);
      expect(fields.iterations).toBe(3);
    });

    it('aggregates the runs each iteration triggered', async () => {
      const applyNativeActions = {
        execute: vi.fn()
          .mockResolvedValueOnce({ ticketId: 't-a', actionsApplied: 1, changed: [], triggeredRunIds: ['r-a'] })
          .mockResolvedValueOnce({ ticketId: 't-b', actionsApplied: 1, changed: [], triggeredRunIds: ['r-b'] }),
      };
      const exec = new NativeStepExecutor(applyNativeActions as never);

      const result = await exec.execute(
        fanOut('{{ steps.scan.items }}', { scan: { items: ['a', 'b'] } }) as never,
      );

      expect((result.output.schemaFields as Record<string, unknown>).triggeredRunIds).toEqual(['r-a', 'r-b']);
    });
  });
});
