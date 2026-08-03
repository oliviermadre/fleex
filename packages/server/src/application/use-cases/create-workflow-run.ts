import { randomUUID } from 'node:crypto';

import { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import {
  WorkflowRunAlreadyActiveError,
  WorkflowTemplateNotFoundError,
} from '../../domain/errors.js';

import type { EventBus } from '../event-bus.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';

export type { OrchestratorPort };

export class CreateWorkflowRunUseCase {
  constructor(
    private readonly templateStore: WorkflowTemplateStorePort,
    private readonly runStore: WorkflowRunStorePort,
    private readonly orchestrator: OrchestratorPort,
    private readonly eventBus: EventBus,
    private readonly postComment: PostCommentUseCase,
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

    // Post a "starting" marker comment in the ticket timeline so it's obvious
    // to readers that the next bursts of activity belong to this workflow run.
    // Emoji + bold name keep it scannable; the trigger source helps debugging.
    await this.postComment.execute({
      ticketId: run.ticketId,
      authorType: 'agent',
      authorName: `workflow:${template.name}`,
      body: `🚦 Starting workflow ${template.emoji ? `${template.emoji} ` : ''}**${template.name}** _(triggered ${params.triggeredFrom === 'mention' ? 'via @mention' : `from ${params.triggeredFrom}`})_`,
    });

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
