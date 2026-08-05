import { describeEdge } from '@fleex/shared';
import type { StepOutput, WorkflowEdge, WorkflowStep } from '@fleex/shared';
import type { StepRunEntity } from '../../domain/entities/step-run.entity.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { EventBus } from '../event-bus.js';
import type { PostCommentUseCase } from '../use-cases/post-comment.js';
import { postWorkflowComment } from './workflow-comment.js';

/**
 * Pausing a run because several edges matched, from the two places edges are
 * resolved (a step completing, and a human gate being resolved).
 *
 * Kept here rather than duplicated so the two paths can never drift on the
 * ordering that matters: persist the step run *and* the run before emitting,
 * and never let the comment (a notification, not a source of truth) block the
 * pause.
 */
export interface PauseForRoutingParams {
  run: WorkflowRunEntity;
  step: WorkflowStep;
  stepRun: StepRunEntity;
  /** The output the step produced — the step succeeded, only its exit is undecided. */
  output: StepOutput;
  candidates: WorkflowEdge[];
  executionId?: string | null;
}

export interface PauseForRoutingDeps {
  runStore: WorkflowRunStorePort;
  stepRunStore: StepRunStorePort;
  eventBus: EventBus;
  postComment: PostCommentUseCase;
  logger?: { error: (msg: string, meta?: Record<string, unknown>) => void };
}

export async function pauseForRouting(
  deps: PauseForRoutingDeps,
  params: PauseForRoutingParams,
): Promise<void> {
  const { run, step, stepRun, candidates } = params;

  stepRun.markAwaitingRouting({
    output: params.output,
    executionId: params.executionId,
    candidateEdgeIds: candidates.map((e) => e.id),
  });
  // `block()` puts the run in `needs_review` — it is waiting on a human exactly
  // like a gate, and a new WorkflowRunStatus would mean touching every status
  // filter (UI, CLI, recovery sweep) for no behavioural gain.
  run.block();
  await deps.stepRunStore.save(stepRun);
  await deps.runStore.save(run);

  await postAmbiguityComment(deps, run, step, stepRun, candidates);

  deps.eventBus.emit({
    type: 'workflow.awaiting_routing',
    workflowRunId: run.id,
    stepRunId: stepRun.id,
    stepId: step.id,
    ticketId: run.ticketId,
    routineId: run.routineId,
    candidateEdgeIds: candidates.map((e) => e.id),
    occurredAt: new Date(),
  });
}

async function postAmbiguityComment(
  deps: PauseForRoutingDeps,
  run: WorkflowRunEntity,
  step: WorkflowStep,
  stepRun: StepRunEntity,
  candidates: WorkflowEdge[],
): Promise<void> {
  const steps = run.templateSnapshot.steps;
  // GFM without `breaks`: blocks must be separated by blank lines. No @mention —
  // same rule as the human gate comment: the card is the call to action, a
  // mention would chain an agent onto a decision only a human can make.
  const body = [
    '**Ambiguous routing** — several outgoing edges matched at once, so the run is paused.',
    '',
    'Pick the branch to follow:',
    '',
    ...candidates.map((e) => `- ${describeEdge(e, steps)}`),
  ].join('\n');

  try {
    await postWorkflowComment(deps.postComment, deps.eventBus, {
      ticketId: run.ticketId,
      authorName: `workflow:${run.templateSnapshot.name} → ${step.name}`,
      body,
      visibility: 'public',
    });
  } catch (err) {
    deps.logger?.error('Failed to post ambiguous routing comment', {
      ticketId: run.ticketId,
      stepRunId: stepRun.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
