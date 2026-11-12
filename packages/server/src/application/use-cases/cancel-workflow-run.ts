import type { StopAuthor } from '@fleex/shared';
import { WorkflowRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { CancelExecutionPort } from '../ports/cancel-execution.port.js';
import type { EventBus } from '../event-bus.js';

export class CancelWorkflowRunUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly canceller: CancelExecutionPort,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * `stop.by` is who cancels (`user` from the UI or the CLI, `assistant` from
   * its thread tools). It is stored on the run and on the step execution that
   * gets aborted, so nothing downstream mistakes a wanted cancel for a failure.
   */
  async execute(workflowRunId: string, stop?: { by: StopAuthor; reason?: string | null }): Promise<void> {
    const run = await this.runStore.getById(workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(workflowRunId);
    // Idempotent only against a run already settled to a terminal state. A
    // `failed` run IS cancellable: the user may want to abandon it (and abort any
    // still-lingering step execution) instead of retrying. Using `isActive()`
    // here made a failed run un-cancellable, trapping the user with no way out.
    if (run.status === 'cancelled' || run.status === 'completed') return;

    run.cancel(stop?.by ?? null);
    await this.runStore.save(run);

    // Abort the agent execution of whatever step is still running. Without this
    // the run flips to `cancelled` in the DB but the agent keeps working on the
    // worktree. Best-effort & idempotent: a failed/absent abort never blocks the
    // cancel (e.g. orphan step after a crash with no live execution).
    const stepRuns = await this.stepRunStore.getByWorkflowRun(run.id);
    for (const stepRun of stepRuns) {
      if (stepRun.status !== 'running') continue;
      if (stepRun.executionId) {
        try {
          await (stop ? this.canceller.cancelExecution(stepRun.executionId, stop) : this.canceller.cancelExecution(stepRun.executionId));
        } catch {
          // swallow — cancelling the run must succeed regardless
        }
      }
      stepRun.cancel();
      await this.stepRunStore.save(stepRun);
    }

    this.eventBus.emit({
      type: 'workflow.run_cancelled',
      workflowRunId: run.id,
      ticketId: run.ticketId,
      routineId: run.routineId,
      cancelledBy: run.cancelledBy,
      reason: stop?.reason ?? null,
      occurredAt: new Date(),
    });
  }
}
