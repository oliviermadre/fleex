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

  async execute(workflowRunId: string): Promise<void> {
    const run = await this.runStore.getById(workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(workflowRunId);
    if (!run.isActive()) return; // idempotent

    run.cancel();
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
          await this.canceller.cancelExecution(stepRun.executionId);
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
      occurredAt: new Date(),
    });
  }
}
