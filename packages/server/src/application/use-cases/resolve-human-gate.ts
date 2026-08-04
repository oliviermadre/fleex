import { EdgeEvaluator } from '../services/edge-evaluator.js';
import { pauseForRouting } from '../services/ambiguous-routing.js';
import {
  WorkflowRunNotFoundError, StepRunNotFoundError, InvalidGateOutcomeError,
} from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { EventBus } from '../event-bus.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class ResolveHumanGateUseCase {
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
    outcome: string;
    notes?: string;
  }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    const step = run.findStep(stepRun.stepId);
    if (!step || step.executorType !== 'human_gate') {
      throw new Error(`step "${stepRun.stepId}" is not a human_gate`);
    }

    const allowed = step.humanGateOutcomes ?? [];
    if (!allowed.includes(params.outcome)) {
      throw new InvalidGateOutcomeError(params.outcome, allowed);
    }

    stepRun.resolveGate(params.outcome, params.notes);

    // Decision Trail: persist the reviewer's rationale as a ticket comment so it can be
    // found later in the thread. Non-critical side effect — a failure here must never
    // block gate resolution.
    await this.postResolutionComment(run.ticketId, run.templateSnapshot.name, step.name, params.outcome, params.notes, stepRun.id);

    const edges = run.outgoingEdges(step.id);
    // Same context as a normal step completion: a gate's outgoing edges may
    // condition on any ancestor's output, not just on the chosen outcome.
    const allStepRuns = await this.stepRunStore.getByWorkflowRun(run.id);
    const previousOutputs: Record<string, Record<string, unknown>> = {};
    for (const sr of allStepRuns) {
      if (sr.stepId === step.id) continue;
      if (sr.status === 'completed' && sr.output) {
        previousOutputs[sr.stepId] = (sr.output.schemaFields as Record<string, unknown>) ?? {};
      }
    }
    const resolution = EdgeEvaluator.resolve({ current: stepRun.output!, steps: previousOutputs }, edges);

    // A gate's outgoing edges can be ambiguous just like any other step's — the
    // outcome the reviewer picked may satisfy two conditions at once. Park and
    // ask a second time rather than guess.
    if (resolution.kind === 'ambiguous') {
      await pauseForRouting(
        {
          runStore: this.runStore, stepRunStore: this.stepRunStore,
          eventBus: this.eventBus, postComment: this.postComment, logger: this.logger,
        },
        { run, step, stepRun, output: stepRun.output!, candidates: resolution.edges },
      );
      return;
    }

    const nextEdge = resolution.kind === 'single' ? resolution.edge : null;
    stepRun.nextEdgeId = nextEdge?.id ?? null;
    await this.stepRunStore.save(stepRun);

    this.eventBus.emit({
      type: 'workflow.step_completed', workflowRunId: run.id, stepRunId: stepRun.id,
      stepId: step.id, ticketId: run.ticketId, nextEdgeId: nextEdge?.id ?? null, occurredAt: new Date(),
    });

    if (nextEdge) {
      run.advanceTo(nextEdge.target);
      await this.runStore.save(run);
      this.orchestrator.runStep(run.id, nextEdge.target);
    } else {
      run.complete();
      await this.runStore.save(run);
      this.eventBus.emit({
        type: 'workflow.run_completed', workflowRunId: run.id, ticketId: run.ticketId, occurredAt: new Date(),
      });
    }
  }

  private async postResolutionComment(
    ticketId: string,
    workflowName: string,
    stepName: string,
    outcome: string,
    notes: string | undefined,
    stepRunId: string,
  ): Promise<void> {
    // Always leave a decision trail, even with no rationale: a silent resolve (e.g. a reject
    // loop-back) would otherwise be impossible to reconstruct from the thread. When the reviewer
    // leaves the reason empty/blank we fall back to a placeholder rather than skipping the comment.
    const trimmedNotes = notes?.trim();
    const reason = trimmedNotes || 'no reason provided';

    // The comment renderer uses GFM *without* `breaks`, so a single newline collapses to a
    // space — blocks must be separated by blank lines. The reason is dropped in as-is (not
    // escaped) so any markdown the reviewer wrote is rendered in the comments view.
    const body = [
      `**User decision :** *${outcome}*`,
      '',
      '**Reason :**',
      '',
      reason,
    ].join('\n');

    try {
      await this.postComment.execute({
        ticketId,
        // Attributed like every other workflow step comment, so it renders consistently
        // in the thread (e.g. "workflow:Spec Dev PR → Check Spec"). Agent authorship also
        // means any @mention a reviewer types inside their notes stays inert (no chaining).
        authorName: `workflow:${workflowName} → ${stepName}`,
        authorType: 'agent',
        body,
        visibility: 'public',
        parentId: null,
      });
    } catch (err) {
      this.logger.error('Failed to post human gate resolution comment', {
        ticketId,
        stepRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
