import type { StepOutput, WorkflowStep } from '@fleex/shared';
import type { StepExecutor, StepExecutionInput } from '../application/services/step-executors/types.js';
import type { SubmitDeliverableUseCase } from '../application/use-cases/submit-deliverable.js';
import type { PostCommentUseCase } from '../application/use-cases/post-comment.js';
import type { AgentEventStorePort } from '../application/ports/agent-event-store.port.js';
import type { EventBus } from '../application/event-bus.js';
import type { FactoryItemRow, FactoryRunRow, ItemBody, StationSpec } from './types.js';
import { itemBrief, itemHeading } from './item-brief.js';

export interface StationRunResult {
  status: 'completed' | 'question' | 'failed';
  outcome: string;
  executionId: string | null;
  error: string | null;
  /** On an item: what the agent answered (it has no thread to post it in), and the deliverable it produced. */
  reply?: string | null;
  deliverableId?: string | null;
}
/** An item a station runs on, and what stations said about it before. */
export interface ItemRunTarget { item: FactoryItemRow; earlier: FactoryRunRow[]; /** The whole of its latest message, when one was kept. */ body?: ItemBody | null }

export interface StationRunnerPort {
  /** On an item, `ticketId` is the item's id and `item` says what it is: the run has no ticket, the item is its brief. */
  run(station: StationSpec, ticketId: string, runId: string, targets: Record<string, string>, onExecutionStarted: (executionId: string) => void, item?: ItemRunTarget): Promise<StationRunResult>;
}

/**
 * Runs one station on one ticket by reusing the workflow step executors as they
 * are: the station is presented to them as a one-step workflow named "Factory",
 * so the agent gets the same prompt, tools, concurrency slot and cost tracking
 * as a workflow step. What the agent returns (comment, deliverable) is posted
 * on the ticket the way a workflow step does it.
 *
 * On an item there is no ticket: the run is one with a subject, as a routine's
 * is (`ticketId: null`), whose brief is the item in words (`itemBrief`). What
 * the agent wrote is returned as `reply` for the engine to keep with the visit,
 * and its deliverable is saved with no ticket.
 */
export class StationRunner implements StationRunnerPort {
  constructor(private readonly deps: {
    executors: Partial<Record<'agent' | 'skill' | 'panel', StepExecutor>>;
    /** Runs a script station: shell commands, no agent. */
    script?: (station: StationSpec, ticketId: string) => Promise<StationRunResult>;
    submitDeliverable: SubmitDeliverableUseCase;
    postComment: PostCommentUseCase;
    agentEventStore: AgentEventStorePort;
    eventBus: EventBus;
  }) {}

  async run(station: StationSpec, ticketId: string, runId: string, targets: Record<string, string>, onExecutionStarted: (executionId: string) => void, item?: ItemRunTarget): Promise<StationRunResult> {
    if (station.exec === 'script' && item) return { status: 'failed', outcome: '', executionId: null, error: 'A script station runs in a ticket\'s worktrees: it cannot run on an item' };
    if (station.exec === 'script') {
      if (!this.deps.script) return { status: 'failed', outcome: '', executionId: null, error: 'Script stations cannot run here' };
      try { return await this.deps.script(station, ticketId); }
      catch (err) { return { status: 'failed', outcome: '', executionId: null, error: err instanceof Error ? err.message : String(err) }; }
    }
    const executor = this.deps.executors[station.exec as 'agent' | 'skill' | 'panel'];
    if (!executor) return { status: 'failed', outcome: '', executionId: null, error: `No executor for "${station.exec}"` };
    const name = station.name || 'Station';
    const outcomes = station.outcomes.length ? station.outcomes : ['ok'];
    const branching = outcomes.length > 1;
    const step: WorkflowStep = {
      id: station.id, name, executorType: station.exec as 'agent' | 'skill' | 'panel', executorRef: station.ref ?? '',
      mode: station.mode, prompt: station.prompt,
      outputSchema: branching
        ? { type: 'object', properties: { outcome: { type: 'string', enum: outcomes, description: `Which way the ${item ? 'item' : 'ticket'} leaves this station.` } }, required: ['outcome'] }
        : undefined,
      position: { x: 0, y: 0 },
    };
    const input: StepExecutionInput = {
      ticketId: item ? null : ticketId, routineId: null,
      subject: item ? { repos: [], brief: itemBrief(item.item, item.earlier, item.body ?? null), heading: itemHeading(item.item) } : null,
      workflowRunId: runId, stepRunId: runId, step,
      modelOverride: station.exec === 'agent' || station.exec === 'skill' ? station.model || null : null,
      workflowContext: {
        workflowName: 'Factory', stepName: name,
        outgoingEdges: branching
          ? outcomes.map((o) => ({ id: `${station.id}:${o}`, label: o, condition: { field: 'outcome', operator: 'eq' as const, value: o }, targetName: targets[o] ?? 'the next machine' }))
          : [],
        previousOutputs: {},
      },
      onExecutionStarted,
    };

    let executionId: string | null = null;
    try {
      const result = await executor.execute(input);
      executionId = result.executionId ?? null;
      const output = result.output;
      if (output.result === 'ko') return { status: 'failed', outcome: '', executionId, error: 'The agent returned no usable output' };
      const kept = item ? await this.keepForItem(name, output, executionId) : (await this.persistArtifacts(name, ticketId, output, executionId), {});
      if (output.result === 'needs_review') return { status: 'question', outcome: '', executionId, error: null, ...kept };
      const declared = typeof output.schemaFields['outcome'] === 'string' ? (output.schemaFields['outcome'] as string) : '';
      return { status: 'completed', outcome: outcomes.includes(declared) ? declared : outcomes[0]!, executionId, error: null, ...kept };
    } catch (err) {
      return { status: 'failed', outcome: '', executionId, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** On an item: the deliverable is saved with no ticket, and what the agent wrote is handed back to be kept with the visit. */
  private async keepForItem(stationName: string, output: StepOutput, executionId: string | null): Promise<{ reply: string | null; deliverableId: string | null }> {
    let deliverableId: string | null = null;
    if (output.deliverable) {
      const author = `Factory → ${stationName}`;
      const deliverable = await this.deps.submitDeliverable.execute({
        ticketId: null, agentName: author, type: output.deliverable.type, title: output.deliverable.title,
        content: output.deliverable.markdown, status: output.deliverable.status,
      });
      deliverableId = deliverable.id;
      this.deps.eventBus.emit({
        type: 'deliverable.created', deliverableId, ticketId: null, workflowRunId: null, stepRunId: null, agentName: author,
        status: (output.deliverable.status ?? 'final') as 'draft' | 'final', title: deliverable.title, occurredAt: new Date(),
      });
    }
    if (executionId && deliverableId) await this.deps.agentEventStore.setExecutionOutputs(executionId, { deliverableId });
    return { reply: output.comment?.trim() || null, deliverableId };
  }

  /** Mirrors `RunWorkflowStepUseCase.persistStepArtifacts`, minus the step-run anchor the Factory does not have. */
  private async persistArtifacts(stationName: string, ticketId: string, output: StepOutput, executionId: string | null): Promise<void> {
    const author = `Factory → ${stationName}`;
    const now = new Date();
    let deliverableId: string | undefined;
    let commentId: string | undefined;
    if (output.deliverable) {
      const deliverable = await this.deps.submitDeliverable.execute({
        ticketId, agentName: author, type: output.deliverable.type, title: output.deliverable.title,
        content: output.deliverable.markdown, status: output.deliverable.status,
      });
      deliverableId = deliverable.id;
      this.deps.eventBus.emit({
        type: 'deliverable.created', deliverableId: deliverable.id, ticketId, workflowRunId: null, stepRunId: null, agentName: author,
        status: (output.deliverable.status ?? 'final') as 'draft' | 'final', title: deliverable.title, occurredAt: now,
      });
    }
    if (output.comment && output.comment.trim().length > 0) {
      const { comment } = await this.deps.postComment.execute({ ticketId, authorType: 'agent', authorName: author, body: output.comment });
      commentId = comment.id;
      // No created mentions, as for a workflow step: the floor routes the ticket, a comment must not start agents.
      this.deps.eventBus.emit({ type: 'comment.posted', commentId: comment.id, ticketId, authorType: 'agent', authorName: author, createdMentions: [], occurredAt: now });
    }
    if (executionId && (commentId || deliverableId)) await this.deps.agentEventStore.setExecutionOutputs(executionId, { commentId, deliverableId });
  }
}
