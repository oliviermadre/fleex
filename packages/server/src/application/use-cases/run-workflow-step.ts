import { randomUUID } from 'node:crypto';
import { StepRunEntity } from '../../domain/entities/step-run.entity.js';
import { EdgeEvaluator } from '../services/edge-evaluator.js';
import { WorkflowRunNotFoundError, ExecutionCancelledError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { StepExecutor, StepExecutionInput } from '../services/step-executors/types.js';
import type { EventBus } from '../event-bus.js';
import type { SubmitDeliverableUseCase } from './submit-deliverable.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { WorkflowExecutorType, StepOutput, WorkflowStep } from '@fleex/shared';

export interface RunWorkflowStepDeps {
  runStore: WorkflowRunStorePort;
  stepRunStore: StepRunStorePort;
  orchestrator: OrchestratorPort;
  eventBus: EventBus;
  executors: Record<WorkflowExecutorType, StepExecutor>;
  submitDeliverable: SubmitDeliverableUseCase;
  postComment: PostCommentUseCase;
  /**
   * Links the step's execution to the artifacts it produced (comment/deliverable).
   * The step's `execute-agent` run completes before the orchestrator persists the
   * artifacts, so we stamp the refs here rather than at completion time.
   */
  agentEventStore: AgentEventStorePort;
}

export class RunWorkflowStepUseCase {
  constructor(private readonly deps: RunWorkflowStepDeps) {}

  async execute(params: { workflowRunId: string; stepId: string }): Promise<void> {
    const run = await this.deps.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const step = run.findStep(params.stepId);
    if (!step) throw new Error(`step "${params.stepId}" not found in run snapshot`);

    // 1. Compute attempt number
    const latest = await this.deps.stepRunStore.getLatestForStep(run.id, step.id);
    const attempt = (latest?.attempt ?? 0) + 1;

    // 2. Create the step_run entity (in-memory, no IO yet)
    const stepRun = StepRunEntity.create({ id: randomUUID(), workflowRunId: run.id, stepId: step.id, attempt });

    try {
      // 2b. Persist + emit step_started inside try so DB failures route to run.fail()
      stepRun.start();
      await this.deps.stepRunStore.save(stepRun);
      this.deps.eventBus.emit({
        type: 'workflow.step_started', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
        ticketId: run.ticketId, occurredAt: new Date(),
      });

      // 3. Build workflow context (previousOutputs from prior step_runs)
      // Filter excludes ALL attempts of the current step (not just this attempt) so retries
      // don't surface stale output of previous completed attempts of the same stepId.
      const allStepRuns = await this.deps.stepRunStore.getByWorkflowRun(run.id);
      const previousOutputs: Record<string, Record<string, unknown>> = {};
      for (const sr of allStepRuns) {
        if (sr.stepId === step.id) continue;
        if (sr.status === 'completed' && sr.output) {
          previousOutputs[sr.stepId] = (sr.output.schemaFields as Record<string, unknown>) ?? {};
        }
      }

      const outgoingEdges = run.outgoingEdges(step.id).map((e) => {
        const target = run.findStep(e.target);
        return {
          id: e.id, label: e.label, condition: e.condition,
          targetName: target?.name ?? e.target,
        };
      });

      // 3b. Resolve the session this attempt may resume. Terminal-state rule:
      //     only a *failed* previous attempt is picked back up — a completed or
      //     cancelled one starts cold. `stepRun.fail()` leaves `executionId`
      //     intact (unlike a fresh attempt), which is what makes this chain
      //     work without any schema change.
      const resumeSessionId = await this.resolveResumeSession(latest);

      const input: StepExecutionInput = {
        ticketId: run.ticketId, workflowRunId: run.id, stepRunId: stepRun.id, step,
        resumeSessionId,
        workflowContext: {
          workflowName: run.templateSnapshot.name, stepName: step.name,
          outgoingEdges, previousOutputs,
        },
        // Persist the live executionId the moment the agent starts, so the run /
        // step can be cancelled while still in flight (Terminate, cancel run,
        // force restart) instead of only after it completes.
        onExecutionStarted: async (executionId) => {
          stepRun.executionId = executionId;
          await this.deps.stepRunStore.save(stepRun);
        },
      };

      // 4. Dispatch to executor
      const executor = this.deps.executors[step.executorType];
      if (!executor) throw new Error(`No executor registered for type "${step.executorType}"`);
      const result = await executor.execute(input);
      const executionId = result.executionId;

      // 5. Handle result
      if (result.output.result === 'needs_review') {
        await this.persistStepArtifacts(run, step, result.output, executionId);
        stepRun.markNeedsReview({ output: result.output, executionId });
        run.block();
        await this.deps.stepRunStore.save(stepRun);
        await this.deps.runStore.save(run);
        this.deps.eventBus.emit({
          type: 'workflow.needs_review', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
          ticketId: run.ticketId, occurredAt: new Date(),
        });
        return;
      }

      // 6. Resolve edges
      const edges = run.outgoingEdges(step.id);
      const nextEdge = EdgeEvaluator.resolve(result.output, edges);
      await this.persistStepArtifacts(run, step, result.output, executionId);
      stepRun.complete({ output: result.output, nextEdgeId: nextEdge?.id ?? null, executionId });
      await this.deps.stepRunStore.save(stepRun);
      this.deps.eventBus.emit({
        type: 'workflow.step_completed', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
        ticketId: run.ticketId, nextEdgeId: nextEdge?.id ?? null, occurredAt: new Date(),
      });

      // 7. Advance or complete
      if (nextEdge) {
        run.advanceTo(nextEdge.target);
        await this.deps.runStore.save(run);
        this.deps.orchestrator.runStep(run.id, nextEdge.target);
      } else {
        run.complete();
        await this.deps.runStore.save(run);
        this.deps.eventBus.emit({
          type: 'workflow.run_completed', workflowRunId: run.id, ticketId: run.ticketId, occurredAt: new Date(),
        });
      }
    } catch (err) {
      // An explicit user interruption (Terminate / cancel run / force restart)
      // is not a failure: the execution was already marked `interrupted` and the
      // run/step were (or will be) marked `cancelled` by the cancelling
      // use-case. Don't fail the run or emit `workflow.run_failed`, and don't
      // advance the edge — just make sure the step_run isn't left `running`.
      if (err instanceof ExecutionCancelledError) {
        if (stepRun.status === 'running') {
          stepRun.cancel();
          await this.deps.stepRunStore.save(stepRun);
        }
        // Emit a workflow event so the Workflow view refreshes live. Without
        // this, a Terminate on a step leaves the UI showing "running" until a
        // manual page refresh (the DB is `cancelled`, but nothing was pushed).
        this.deps.eventBus.emit({
          type: 'workflow.step_cancelled', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
          ticketId: run.ticketId, occurredAt: new Date(),
        });
        return;
      }
      stepRun.fail({ message: err instanceof Error ? err.message : String(err) });
      run.fail();
      await this.deps.stepRunStore.save(stepRun);
      await this.deps.runStore.save(run);
      this.deps.eventBus.emit({
        type: 'workflow.run_failed', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
        ticketId: run.ticketId, error: err instanceof Error ? err.message : String(err), occurredAt: new Date(),
      });
    }
  }

  /**
   * The SDK session a new attempt of a step may resume.
   *
   * Walks `step_run.executionId → agent_event_executions.sdk_session_id`. No new
   * column: the step run already stores the execution it produced, and the
   * execution already stores its SDK session — the link just was never followed,
   * so every Retry restarted the agent from zero (ticket #454).
   *
   * Returns `undefined` unless the previous attempt actually *failed*: retrying
   * a step whose last attempt completed (a re-run from the top) is a fresh piece
   * of work, and there is no session to resume before the first attempt.
   */
  private async resolveResumeSession(latest: StepRunEntity | null): Promise<string | undefined> {
    if (latest?.status !== 'failed' || !latest.executionId) return undefined;
    const execution = await this.deps.agentEventStore.getExecutionById(latest.executionId);
    return execution?.sdkSessionId ?? undefined;
  }

  /**
   * Persist the agent-emitted `deliverable` and `comment` from a step output as
   * first-class ticket artifacts (ticket_deliverable / ticket_comment), so they
   * appear in the ticket's Deliverables and Comments tabs as soon as the step
   * emits them — including in the `needs_review` branch (the draft is visible
   * before the human responds). No dedup on retry: a new attempt = new
   * artifacts; that's the audit trail.
   */
  private async persistStepArtifacts(
    run: WorkflowRunEntity,
    step: WorkflowStep,
    output: StepOutput,
    executionId: string | undefined,
  ): Promise<void> {
    const author = `workflow:${run.templateSnapshot.name} → ${step.name}`;
    const now = new Date();
    let deliverableId: string | undefined;
    let commentId: string | undefined;
    if (output.deliverable) {
      const deliverable = await this.deps.submitDeliverable.execute({
        ticketId: run.ticketId,
        agentName: author,
        type: output.deliverable.type,
        title: output.deliverable.title,
        content: output.deliverable.markdown,
        status: output.deliverable.status,
      });
      deliverableId = deliverable.id;
      // Emit deliverable.created so the BroadcastRegistrar pushes it to the UI in
      // real time — mirrors execute-agent/run-panel. Without this, the deliverable
      // only appears after a manual refresh.
      this.deps.eventBus.emit({
        type: 'deliverable.created',
        deliverableId: deliverable.id,
        ticketId: run.ticketId,
        agentName: author,
        status: (output.deliverable.status ?? 'final') as 'draft' | 'final',
        title: deliverable.title,
        occurredAt: now,
      });
    }
    if (output.comment && output.comment.trim().length > 0) {
      const { comment } = await this.deps.postComment.execute({
        ticketId: run.ticketId,
        authorType: 'agent',
        authorName: author,
        body: output.comment,
      });
      commentId = comment.id;
      // Emit comment.posted for the real-time UI broadcast. createdMentions is left
      // empty on purpose: workflows orchestrate via edges, not mentions, so we don't
      // want a step comment to auto-trigger agents or the auto-review workflow.
      this.deps.eventBus.emit({
        type: 'comment.posted',
        commentId: comment.id,
        ticketId: run.ticketId,
        authorType: 'agent',
        authorName: author,
        createdMentions: [],
        occurredAt: now,
      });
    }

    // Link the execution to the artifacts it produced, so the Comments tab can
    // derive a deliverable chip (and the Human Gate deliverable) from an explicit
    // FK instead of pattern-matching on `agentName`. Deterministic executors
    // (e.g. human_gate) have no execution to stamp.
    if (executionId && (commentId || deliverableId)) {
      await this.deps.agentEventStore.setExecutionOutputs(executionId, { commentId, deliverableId });
    }
  }
}
