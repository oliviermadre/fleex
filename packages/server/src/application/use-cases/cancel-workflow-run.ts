import { WorkflowRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { EventBus } from '../event-bus.js';

export class CancelWorkflowRunUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(workflowRunId: string): Promise<void> {
    const run = await this.runStore.getById(workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(workflowRunId);
    if (!run.isActive()) return; // idempotent

    run.cancel();
    await this.runStore.save(run);
    this.eventBus.emit({
      type: 'workflow.run_cancelled',
      workflowRunId: run.id,
      ticketId: run.ticketId,
      occurredAt: new Date(),
    });
  }
}
