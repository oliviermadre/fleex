import { describe, it, expect, vi } from 'vitest';
import { RunWorkflowStepUseCase } from '../../src/application/use-cases/run-workflow-step.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { ExecutionCancelledError } from '../../src/domain/errors.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'Spec Dev PR', emoji: '🔧',
    steps: [
      { id: 'a', name: 'Build', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } },
      { id: 'b', name: 'Review', executorType: 'agent', executorRef: 'p2', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', isDefault: true }],
    entryStepId: 'a',
  },
  triggeredBy: '@nas', triggeredFrom: 'api',
});

/**
 * Wires the use case with an agent executor that throws ExecutionCancelledError
 * (a user Terminate on the running step). `otherAttempts` seeds what
 * getByWorkflowRun reports for the step — an attempt > 1 means a force-restart
 * re-dispatched a fresh attempt, in which case the run must NOT be parked.
 */
const setup = (otherAttempts: Array<{ stepId: string; attempt: number }> = []) => {
  const run = makeRun();
  const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
  const stepRunStore = {
    save: vi.fn(),
    getLatestForStep: vi.fn().mockResolvedValue(null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getByWorkflowRun: vi.fn().mockResolvedValue(otherAttempts as any),
  };
  const agentExecutor = { execute: vi.fn().mockRejectedValue(new ExecutionCancelledError('exec-1')) };
  const eventBus = { emit: vi.fn() };
  const orchestrator = { runStep: vi.fn() };

  const uc = new RunWorkflowStepUseCase({
    runStore: runStore as never,
    stepRunStore: stepRunStore as never,
    orchestrator: orchestrator as never,
    eventBus: eventBus as never,
    executors: {
      agent: agentExecutor as never,
      skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never,
    },
    submitDeliverable: { execute: vi.fn() } as never,
    postComment: { execute: vi.fn() } as never,
    agentEventStore: { setExecutionOutputs: vi.fn() } as never,
  });

  return { uc, run, runStore, stepRunStore, eventBus, orchestrator };
};

describe('RunWorkflowStepUseCase when a running step is terminated', () => {
  // WHY: the reported bug — terminating a step cancelled the step but left the RUN
  // `running`, so the ticket showed a phantom "Running for 2h". Parking it in
  // `needs_review` makes it surface as "needs you" until the human restarts.
  it('parks the run in needs_review (awaiting restart) on a bare step terminate', async () => {
    const { uc, run, runStore, eventBus, orchestrator } = setup();

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).toBe('needs_review');
    expect(run.currentStepId).toBe('a'); // still parked on the terminated step
    expect(runStore.save).toHaveBeenCalledWith(run);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.step_cancelled', stepId: 'a' }),
    );
    // The run does NOT advance and does NOT fail.
    expect(orchestrator.runStep).not.toHaveBeenCalled();
  });

  // WHY: this cancel branch is shared with force-restart, which aborts the old
  // execution (→ this error) but re-dispatches a fresh attempt and sets the run
  // back to running itself. Parking then would clobber the restart. A newer
  // attempt of the step is the signal to skip parking.
  it('does NOT park the run when a newer attempt exists (force-restart in flight)', async () => {
    const { uc, run, runStore, eventBus } = setup([{ stepId: 'a', attempt: 2 }]);

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).toBe('running'); // left for the restart to drive
    expect(runStore.save).not.toHaveBeenCalled();
    // The step_cancelled event still fires so the UI refreshes.
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.step_cancelled' }),
    );
  });

  // WHY: whole-run cancel sets the run terminal (`cancelled`) before aborting the
  // step's execution. The park guard must not resurrect it back to needs_review.
  it('does NOT park a run that was already cancelled (whole-run cancel)', async () => {
    const { uc, run, runStore } = setup();
    // Simulate cancel-workflow-run having set the run terminal before this catch.
    const cancelled = makeRun();
    cancelled.cancel();
    runStore.getById.mockResolvedValueOnce(run).mockResolvedValueOnce(cancelled);

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(cancelled.status).toBe('cancelled');
    expect(runStore.save).not.toHaveBeenCalled();
  });
});
