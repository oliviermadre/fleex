import {
  WorkflowRunNotFoundError, StepRunNotFoundError,
  InvalidRouteEdgeError, StepNotAwaitingRoutingError,
} from '../../domain/errors.js';
import { describeEdge } from '@fleex/shared';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { EventBus } from '../event-bus.js';
import type { PostCommentUseCase } from './post-comment.js';
import { postWorkflowComment } from '../services/workflow-comment.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';

/**
 * A human picked which of the several matching edges the run should follow.
 *
 * Mirrors {@link ResolveHumanGateUseCase}: validate, resolve, leave a decision
 * trail, then hand back to the orchestrator. The candidate list is read from the
 * step run's persisted `output.routing` rather than re-evaluated, so editing the
 * template while a run is parked can never turn a legitimate choice into a 400.
 */
export class ResolveAmbiguousRouteUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly orchestrator: OrchestratorPort,
    private readonly eventBus: EventBus,
    private readonly postComment: PostCommentUseCase,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    workflowRunId: string;
    stepRunId: string;
    edgeId: string;
    decidedBy?: string;
    notes?: string;
  }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    if (stepRun.status !== 'awaiting_routing') {
      throw new StepNotAwaitingRoutingError(stepRun.id, stepRun.status);
    }

    const candidates = stepRun.output?.routing?.candidateEdgeIds ?? [];
    if (!candidates.includes(params.edgeId)) {
      throw new InvalidRouteEdgeError(params.edgeId, candidates);
    }

    const edge = run.templateSnapshot.edges.find((e) => e.id === params.edgeId);
    if (!edge) throw new InvalidRouteEdgeError(params.edgeId, candidates);

    const step = run.findStep(stepRun.stepId);
    const decidedBy = params.decidedBy ?? 'human';
    stepRun.resolveRoute({ edgeId: edge.id, decidedBy, notes: params.notes });
    await this.stepRunStore.save(stepRun);

    await this.postResolutionComment(run, step?.name ?? stepRun.stepId, edge.id, params.notes, stepRun.id);

    this.eventBus.emit({
      type: 'workflow.step_completed', workflowRunId: run.id, stepRunId: stepRun.id,
      stepId: stepRun.stepId, ticketId: run.ticketId, routineId: run.routineId,
      nextEdgeId: edge.id, occurredAt: new Date(),
    });

    run.advanceTo(edge.target);
    await this.runStore.save(run);
    this.orchestrator.runStep(run.id, edge.target);
  }

  /** Decision trail, same shape as the human gate's — best effort, never blocks. */
  private async postResolutionComment(
    run: WorkflowRunEntity,
    stepName: string,
    edgeId: string,
    notes: string | undefined,
    stepRunId: string,
  ): Promise<void> {
    const edge = run.templateSnapshot.edges.find((e) => e.id === edgeId);
    const label = edge ? describeEdge(edge, run.templateSnapshot.steps) : edgeId;
    const trimmed = notes?.trim();

    const body = [
      `**Route chosen :** *${label}*`,
      '',
      '**Reason :**',
      '',
      trimmed || 'no reason provided',
    ].join('\n');

    try {
      await postWorkflowComment(this.postComment, this.eventBus, {
        ticketId: run.ticketId,
        authorName: `workflow:${run.templateSnapshot.name} → ${stepName}`,
        body,
        visibility: 'public',
      });
    } catch (err) {
      this.logger.error('Failed to post ambiguous route resolution comment', {
        ticketId: run.ticketId,
        stepRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
