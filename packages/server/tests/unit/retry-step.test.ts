import { describe, it, expect, vi } from 'vitest';
import { RetryStepUseCase } from '../../src/application/use-cases/retry-step.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { WorkflowRunNotFoundError, StepRunNotFoundError } from '../../src/domain/errors.js';

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

describe('RetryStepUseCase', () => {
  it('throws when the run is missing', async () => {
    const runStore = { getById: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const stepRunStore = { getById: vi.fn(), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);
    await expect(uc.execute({ workflowRunId: 'missing', stepRunId: 'sr-1' })).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
  });

  it('throws when the step_run is missing', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);
    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'missing' })).rejects.toBeInstanceOf(StepRunNotFoundError);
  });

  // WHY (AC4): force-restart on a genuinely-alive step must abort the old agent
  // BEFORE spawning the new one, otherwise two agents run in parallel on the
  // same worktree.
  it('aborts the live execution before restarting the step', async () => {
    const run = makeRun();
    const step = runningStep('exec-1');
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(step), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn().mockResolvedValue(true) };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' });

    expect(canceller.cancelExecution).toHaveBeenCalledWith('exec-1');
    expect(step.status).toBe('cancelled');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'a');
    // Abort happens before the restart is scheduled.
    const cancelOrder = canceller.cancelExecution.mock.invocationCallOrder[0]!;
    const runOrder = orchestrator.runStep.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(runOrder);
  });

  // WHY (AC6): orphan step after a crash has no live execution — restart must
  // still proceed without an abort.
  it('restarts without aborting when the step has no live executionId', async () => {
    const run = makeRun();
    const step = runningStep(null);
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(step), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' });

    expect(canceller.cancelExecution).not.toHaveBeenCalled();
    expect(step.status).toBe('cancelled');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'a');
  });

  // WHY (#320): a step deliberately terminated from the UI settles to
  // `cancelled`. The user must be able to restart it from the workflow view —
  // restart re-arms the run to `running` and spawns a fresh attempt. The step is
  // no longer running, so there is nothing to abort.
  it('restarts a cancelled step and re-arms the run to running', async () => {
    const run = makeRun();
    run.cancel(); // run settled after the step was terminated
    const step = runningStep('exec-1');
    step.cancel(); // step already settled to `cancelled`
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(step), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' });

    // Not running anymore → no second abort attempt.
    expect(canceller.cancelExecution).not.toHaveBeenCalled();
    // Run is re-armed and the step is re-scheduled (attempt+1 created downstream).
    expect(run.status).toBe('running');
    expect(run.currentStepId).toBe('a');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'a');
  });

  it('still restarts when the abort throws (best-effort)', async () => {
    const run = makeRun();
    const step = runningStep('exec-1');
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(step), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn().mockRejectedValue(new Error('gone')) };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);

    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' })).resolves.toBeUndefined();

    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'a');
  });

  // WHY: on a routine run there is no ticket to post the answer to, so the retry
  // IS the answer's only carrier. If it isn't persisted on the attempt that
  // asked, the new attempt re-runs on an identical prompt and asks again.
  it('records the human answer on the paused attempt before restarting', async () => {
    const run = makeRun();
    const step = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'a' });
    step.markNeedsReview({ output: { schemaFields: {}, result: 'needs_review', comment: 'Which repo?' } });
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(step), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', humanResponse: '  fleex only  ' });

    expect(step.output?.humanResponse).toBe('fleex only');
    expect(stepRunStore.save).toHaveBeenCalledWith(step);
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'a');
  });

  it('leaves the output untouched when no answer was given (plain retry)', async () => {
    const run = makeRun();
    const step = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'a' });
    step.fail({ message: 'boom' });
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(step), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const canceller = { cancelExecution: vi.fn() };
    const uc = new RetryStepUseCase(runStore as never, stepRunStore as never, orchestrator as never, canceller as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', humanResponse: '   ' });

    expect(step.output?.humanResponse).toBeUndefined();
    expect(stepRunStore.save).not.toHaveBeenCalled();
  });
});
