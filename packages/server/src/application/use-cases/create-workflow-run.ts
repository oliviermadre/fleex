import { randomUUID } from 'node:crypto';
import { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import { WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError } from '../../domain/errors.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { EventBus } from '../event-bus.js';

export type { OrchestratorPort };

export class CreateWorkflowRunUseCase {
  constructor(
    private readonly templateStore: WorkflowTemplateStorePort,
    private readonly runStore: WorkflowRunStorePort,
    private readonly orchestrator: OrchestratorPort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(params: {
    ticketId: string;
    templateId: string;
    triggeredBy: string;
    triggeredFrom: string;
  }): Promise<WorkflowRunEntity> {
    const existing = await this.runStore.getActiveByTicket(params.ticketId);
    if (existing) throw new WorkflowRunAlreadyActiveError(params.ticketId);

    const template = await this.templateStore.getById(params.templateId);
    if (!template) throw new WorkflowTemplateNotFoundError(params.templateId);

    const run = WorkflowRunEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      templateId: template.id,
      templateSnapshot: {
        name: template.name,
        emoji: template.emoji,
        steps: template.steps,
        edges: template.edges,
        entryStepId: template.entryStepId,
      },
      triggeredBy: params.triggeredBy,
      triggeredFrom: params.triggeredFrom,
    });

    await this.runStore.save(run);
    this.eventBus.emit({
      type: 'workflow.run_created',
      workflowRunId: run.id,
      ticketId: run.ticketId,
      templateId: run.templateId,
      occurredAt: new Date(),
    });

    this.orchestrator.runStep(run.id, run.currentStepId!);
    return run;
  }
}
