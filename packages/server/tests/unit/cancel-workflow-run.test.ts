import { describe, it, expect, vi } from 'vitest';
import { CancelWorkflowRunUseCase } from '../../src/application/use-cases/cancel-workflow-run.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { WorkflowRunNotFoundError } from '../../src/domain/errors.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'W', emoji: '🔧',
    steps: [{ id: 'a', name: 'A', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } }],
    edges: [], entryStepId: 'a',
  },
  triggeredBy: '@john', triggeredFrom: 'x',
});

const runningStep = (executionId: string | null) => {
  const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'a' });
  sr.start();
  sr.executionId = executionId;
  return sr;
};

describe('CancelWorkflowRunUseCase', () => {
  it('throws when the run does not exist', async () => {
    const runStore = { getById: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const stepRunStore = { getByWorkflowRun: vi.fn(), save: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new CancelWorkflowRunUseCase(runStore as never, stepRunStore as never, canceller as never, eventBus as never);
    await expect(uc.execute('missing')).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
  });

  it('is idempotent: no-op on an already-finished run', async () => {
    const run = makeRun();
    run.cancel();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getByWorkflowRun: vi.fn(), save: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new CancelWorkflowRunUseCase(runStore as never, stepRunStore as never, canceller as never, eventBus as never);

    await uc.execute('run-1');

    expect(runStore.save).not.toHaveBeenCalled();
    expect(canceller.cancelExecution).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  // WHY (AC3): cancelling the run must ALSO abort the agent of the step still
  // running, otherwise the run flips to `cancelled` while the agent keeps
  // working on the worktree.
  it('aborts the in-flight step execution and marks the step cancelled', async () => {
    const run = makeRun();
    const step = runningStep('exec-1');
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getByWorkflowRun: vi.fn().mockResolvedValue([step]), save: vi.fn() };
    const canceller = { cancelExecution: vi.fn().mockResolvedValue(true) };
    const eventBus = { emit: vi.fn() };
    const uc = new CancelWorkflowRunUseCase(runStore as never, stepRunStore as never, canceller as never, eventBus as never);

    await uc.execute('run-1');

    expect(run.status).toBe('cancelled');
    expect(canceller.cancelExecution).toHaveBeenCalledWith('exec-1');
    expect(step.status).toBe('cancelled');
    expect(stepRunStore.save).toHaveBeenCalledWith(step);
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_cancelled' }));
  });

  // WHY (AC6): a failed/absent abort must never block cancelling the run.
  it('still cancels the run when the abort throws (best-effort)', async () => {
    const run = makeRun();
    const step = runningStep('exec-1');
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getByWorkflowRun: vi.fn().mockResolvedValue([step]), save: vi.fn() };
    const canceller = { cancelExecution: vi.fn().mockRejectedValue(new Error('gone')) };
    const eventBus = { emit: vi.fn() };
    const uc = new CancelWorkflowRunUseCase(runStore as never, stepRunStore as never, canceller as never, eventBus as never);

    await expect(uc.execute('run-1')).resolves.toBeUndefined();

    expect(run.status).toBe('cancelled');
    expect(step.status).toBe('cancelled');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_cancelled' }));
  });

  it('skips steps that are not running and steps without a live executionId', async () => {
    const run = makeRun();
    const noExec = runningStep(null);            // running but no executionId yet
    const done = StepRunEntity.create({ id: 'sr-2', workflowRunId: 'run-1', stepId: 'a' });
    done.complete({ output: { schemaFields: {}, result: 'ok' } }); // not running
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getByWorkflowRun: vi.fn().mockResolvedValue([noExec, done]), save: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new CancelWorkflowRunUseCase(runStore as never, stepRunStore as never, canceller as never, eventBus as never);

    await uc.execute('run-1');

    expect(canceller.cancelExecution).not.toHaveBeenCalled();
    // The running-but-unlinked step is still flipped to cancelled.
    expect(noExec.status).toBe('cancelled');
    expect(done.status).toBe('completed');
  });
});
