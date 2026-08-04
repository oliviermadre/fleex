import { randomUUID } from 'node:crypto';
import { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import {
  WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError, RoutineRunAlreadyActiveError,
} from '../../domain/errors.js';
import type { RunSubject } from '@fleex/shared';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { EventBus } from '../event-bus.js';
import type { PostCommentUseCase } from './post-comment.js';
import { postWorkflowComment } from '../services/workflow-comment.js';

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
    /** Exactly one of `ticketId` / `routineId` — the entity enforces it. */
    ticketId?: string;
    routineId?: string;
    /**
     * Frozen copy of the routine's subject. Snapshotted at launch so editing a
     * routine mid-run can't change what the run is working on.
     */
    subjectSnapshot?: RunSubject | null;
    templateId: string;
    triggeredBy: string;
    triggeredFrom: string;
  }): Promise<WorkflowRunEntity> {
    // One active run per anchor. Two concurrent runs would race on the same
    // ticket timeline, or on the same routine workspace.
    if (params.ticketId) {
      const existing = await this.runStore.getActiveByTicket(params.ticketId);
      if (existing) throw new WorkflowRunAlreadyActiveError(params.ticketId);
    } else if (params.routineId) {
      const existing = await this.runStore.getActiveByRoutine(params.routineId);
      if (existing) throw new RoutineRunAlreadyActiveError(params.routineId);
    }

    const template = await this.templateStore.getById(params.templateId);
    if (!template) throw new WorkflowTemplateNotFoundError(params.templateId);

    const run = WorkflowRunEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId ?? null,
      routineId: params.routineId ?? null,
      subjectSnapshot: params.subjectSnapshot ?? null,
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
    await postWorkflowComment(this.postComment, this.eventBus, {
      ticketId: run.ticketId,
      authorName: `workflow:${template.name}`,
      body: `🚦 Starting workflow ${template.emoji ? `${template.emoji} ` : ''}**${template.name}** _(triggered ${params.triggeredFrom === 'mention' ? 'via @mention' : `from ${params.triggeredFrom}`})_`,
    });

    this.eventBus.emit({
      type: 'workflow.run_created',
      workflowRunId: run.id,
      ticketId: run.ticketId,
      routineId: run.routineId,
      templateId: run.templateId,
      occurredAt: new Date(),
    });

    this.orchestrator.runStep(run.id, run.currentStepId!);
    return run;
  }
}
