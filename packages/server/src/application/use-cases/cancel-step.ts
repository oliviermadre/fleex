import { WorkflowRunNotFoundError, StepRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { CancelExecutionPort } from '../ports/cancel-execution.port.js';
import type { EventBus } from '../event-bus.js';

/**
 * Abandon a single step without touching the run.
 *
 * This is what backs "dismiss" on the failed-step banner: the banner is derived
 * from `stepRun.status === 'failed'`, so flipping the step to `cancelled` makes
 * it disappear from every surface at once, survives a reload, and stays
 * reversible (a `cancelled` step still offers Restart).
 */
export class CancelStepUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly canceller: CancelExecutionPort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(params: { workflowRunId: string; stepRunId: string }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    if (stepRun.status === 'cancelled') return; // idempotent

    // A step the user abandons while it is still running must have its agent
    // aborted too, otherwise the step reads `cancelled` while the agent keeps
    // working on the worktree. Best-effort, mirroring retry-step: an orphan
    // step left over from a crash has no live execution and that is fine.
    if (stepRun.status === 'running' && stepRun.executionId) {
      try {
        await this.canceller.cancelExecution(stepRun.executionId);
      } catch {
        // swallow — dismissing must succeed regardless
      }
    }

    stepRun.cancel();
    await this.stepRunStore.save(stepRun);

    this.eventBus.emit({
      type: 'workflow.step_cancelled',
      workflowRunId: run.id,
      stepRunId: stepRun.id,
      stepId: stepRun.stepId,
      ticketId: run.ticketId,
      occurredAt: new Date(),
    });
  }
}
