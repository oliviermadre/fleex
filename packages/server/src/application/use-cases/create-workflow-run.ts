import { randomUUID } from 'node:crypto';
import { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import {
  WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError, RoutineRunAlreadyActiveError,
  WorkflowRunDepthExceededError,
} from '../../domain/errors.js';
import type { RunSubject, WorkflowTemplateSnapshot } from '@fleex/shared';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { EventBus } from '../event-bus.js';
import type { PostCommentUseCase } from './post-comment.js';
import { postWorkflowComment } from '../services/workflow-comment.js';

export type { OrchestratorPort };

/**
 * How many `workflow.trigger` hops a run may sit behind.
 *
 * Three is "a workflow may delegate, and its delegate may delegate once more" —
 * every real composition seen so far is one or two hops. Anything deeper is a
 * loop, not a design.
 */
export const MAX_WORKFLOW_RUN_DEPTH = 3;

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
    /** Null iff `templateSnapshot` is provided directly (synthetic run). */
    templateId: string | null;
    /**
     * Direct snapshot for a synthetic run — a routine targeting a single
     * primitive (agent / skill / panel) fabricates a one-step "template" at
     * launch instead of referencing a stored one. Mutually exclusive with
     * `templateId`; everything downstream (orchestrator, DAG, history) treats
     * both kinds of run identically.
     */
    templateSnapshot?: WorkflowTemplateSnapshot;
    triggeredBy: string;
    triggeredFrom: string;
    /** Set when a `workflow.trigger` action spawned this run. Bounds recursion. */
    parentRunId?: string | null;
  }): Promise<WorkflowRunEntity> {
    if ((params.templateId === null) === (params.templateSnapshot === undefined)) {
      throw new Error('exactly one of templateId / templateSnapshot must be provided');
    }
    await this.assertDepthWithinLimit(
      params.parentRunId ?? null,
      params.templateId ?? params.templateSnapshot!.name,
    );

    // One active run per anchor. Two concurrent runs would race on the same
    // ticket timeline, or on the same routine workspace.
    if (params.ticketId) {
      const existing = await this.runStore.getActiveByTicket(params.ticketId);
      if (existing) throw new WorkflowRunAlreadyActiveError(params.ticketId);
    } else if (params.routineId) {
      const existing = await this.runStore.getActiveByRoutine(params.routineId);
      if (existing) throw new RoutineRunAlreadyActiveError(params.routineId);
    }

    let snapshot: WorkflowTemplateSnapshot;
    if (params.templateId !== null) {
      const template = await this.templateStore.getById(params.templateId);
      if (!template) throw new WorkflowTemplateNotFoundError(params.templateId);
      snapshot = {
        name: template.name,
        emoji: template.emoji,
        steps: template.steps,
        edges: template.edges,
        entryStepId: template.entryStepId,
      };
    } else {
      snapshot = params.templateSnapshot!;
    }

    const run = WorkflowRunEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId ?? null,
      routineId: params.routineId ?? null,
      subjectSnapshot: params.subjectSnapshot ?? null,
      templateId: params.templateId,
      templateSnapshot: snapshot,
      triggeredBy: params.triggeredBy,
      triggeredFrom: params.triggeredFrom,
      parentRunId: params.parentRunId ?? null,
    });

    await this.runStore.save(run);

    // Post a "starting" marker comment in the ticket timeline so it's obvious
    // to readers that the next bursts of activity belong to this workflow run.
    // Emoji + bold name keep it scannable; the trigger source helps debugging.
    await postWorkflowComment(this.postComment, this.eventBus, {
      ticketId: run.ticketId,
      authorName: `workflow:${snapshot.name}`,
      body: `🚦 Starting workflow ${snapshot.emoji ? `${snapshot.emoji} ` : ''}**${snapshot.name}** _(triggered ${params.triggeredFrom === 'mention' ? 'via @mention' : `from ${params.triggeredFrom}`})_`,
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

  /**
   * Walks up the chain of parents and refuses past `MAX_WORKFLOW_RUN_DEPTH`.
   *
   * The walk is bounded by the very limit it enforces, so a corrupted chain (a
   * parent pointing at a descendant) terminates by refusing rather than looping
   * forever — which is the safe direction for a guard against runaway spawning.
   */
  private async assertDepthWithinLimit(
    parentRunId: string | null,
    templateId: string,
  ): Promise<void> {
    let cursor = parentRunId;
    let depth = 0;
    while (cursor) {
      depth += 1;
      if (depth > MAX_WORKFLOW_RUN_DEPTH) {
        throw new WorkflowRunDepthExceededError(templateId, MAX_WORKFLOW_RUN_DEPTH);
      }
      const parent = await this.runStore.getById(cursor);
      // A parent that no longer exists ends the chain: the run is at most as
      // deep as what we could actually count.
      cursor = parent?.parentRunId ?? null;
    }
  }
}
