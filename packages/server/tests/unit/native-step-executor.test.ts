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
});
