import type { EventBus } from './event-bus.js';
import type { ThreadStorePort } from './ports/thread-store.port.js';
import type { CommentStorePort } from './ports/comment-store.port.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { WorkflowRunStorePort } from './ports/workflow-run-store.port.js';
import type { RunAssistantTurnUseCase } from './use-cases/run-assistant-turn.js';
import type { AnyDomainEvent } from '../domain/events.js';

export interface AssistantThreadListenerDeps {
  eventBus: EventBus;
  threadStore: ThreadStorePort;
  commentStore: CommentStorePort;
  runAssistantTurn: Pick<RunAssistantTurnUseCase, 'execute'>;
  logger: LoggerPort;
  /** Workflow threads follow their run, not their mention. Null: no workflow support. */
  workflowRunStore?: WorkflowRunStorePort | null;
}

type WorkflowOutcome = 'completed' | 'failed' | 'cancelled' | 'waiting' | 'resumed';

/**
 * Keeps each assistant thread in step with the mention driving it, and wakes the
 * assistant when its agent has answered. Local bus only: one instance runs a
 * thread, hub-relayed events must not trigger a second assistant.
 */
export class AssistantThreadListener {
  constructor(private readonly deps: AssistantThreadListenerDeps) {}

  register(): void {
    const bus = this.deps.eventBus;
    bus.on('mention.resolved', (e) => this.onMention(e, 'resolved'));
    bus.on('mention.waiting_for_info', (e) => this.onMention(e, 'waiting_for_info'));
    bus.on('mention.execution_failed', (e) => this.onMention(e, 'failed'));
    bus.on('mention.woken_up', (e) => this.onWoken(e));
    bus.on('comment.posted', (e) => this.onComment(e));
    bus.on('workflow.run_completed', (e) => this.onWorkflow(e, 'completed'));
    bus.on('workflow.run_failed', (e) => this.onWorkflow(e, 'failed'));
    bus.on('workflow.run_cancelled', (e) => this.onWorkflow(e, 'cancelled'));
    bus.on('workflow.needs_review', (e) => this.onWorkflow(e, 'waiting'));
    bus.on('workflow.awaiting_routing', (e) => this.onWorkflow(e, 'waiting'));
    bus.on('workflow.step_started', (e) => this.onWorkflow(e, 'resumed'));
  }

  private async onMention(e: AnyDomainEvent, status: 'resolved' | 'waiting_for_info' | 'failed'): Promise<void> {
    if (!('mentionId' in e)) return;
    const thread = await this.deps.threadStore.getByCurrentMentionId(e.mentionId);
    if (!thread || thread.isTerminal) return;
    // A workflow mention settles as soon as the run starts; the run's own events
    // drive the thread. Only a failure to start it comes through the mention.
    if (thread.targetType === 'workflow' && status !== 'failed') return;
    if (status === 'failed') {
      thread.fail();
    } else {
      thread.recordTurn();
      if (status === 'waiting_for_info') {
        thread.markWaiting();
      } else {
        // Run complete: nothing executes until the assistant's next turn.
        thread.clearFailures();
        thread.markIdle();
      }
    }
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
    await this.deps.runAssistantTurn.execute({
      ticketId: thread.ticketId,
      trigger: {
        kind: 'thread_reply', threadId: thread.id, mentionStatus: status,
        ...(status === 'failed' && 'reason' in e && 'message' in e ? { failure: { reason: String(e.reason), message: String(e.message) } } : {}),
      },
    });
  }

  /**
   * A workflow thread wakes the assistant when its run stops: done, failed,
   * cancelled, or parked on a human decision (gate / routing). A step starting
   * again after that decision puts the thread back to running, silently.
   */
  private async onWorkflow(e: AnyDomainEvent, outcome: WorkflowOutcome): Promise<void> {
    const runId = 'workflowRunId' in e ? e.workflowRunId : null;
    if (typeof runId !== 'string' || !this.deps.workflowRunStore) return;
    const run = await this.deps.workflowRunStore.getById(runId);
    const mentionId = run?.triggeredFrom.startsWith('mention:') ? run.triggeredFrom.slice('mention:'.length) : null;
    if (!run || !mentionId) return;
    const thread = await this.deps.threadStore.getByCurrentMentionId(mentionId);
    if (!thread || thread.isTerminal || thread.targetType !== 'workflow') return;

    let wake: 'resolved' | 'waiting_for_info' | 'failed';
    if (outcome === 'resumed') {
      if (thread.status !== 'waiting') return;
      thread.markRunning();
      await this.deps.threadStore.save(thread);
      this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
      return;
    } else if (outcome === 'waiting') {
      if (thread.status === 'waiting') return; // already relayed
      thread.markWaiting();
      wake = 'waiting_for_info';
    } else if (outcome === 'completed') {
      thread.recordTurn();
      thread.clearFailures();
      thread.markIdle();
      wake = 'resolved';
    } else {
      thread.fail();
      wake = 'failed';
    }
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
    await this.deps.runAssistantTurn.execute({
      ticketId: thread.ticketId,
      trigger: {
        kind: 'thread_reply', threadId: thread.id, mentionStatus: wake,
        workflowRun: { id: run.id, status: run.status },
        ...(wake === 'failed' ? { failure: { reason: `workflow_${outcome}`, message: `Workflow run ${run.status}` } } : {}),
      },
    });
  }

  private async onWoken(e: AnyDomainEvent): Promise<void> {
    if (!('mentionId' in e)) return;
    const thread = await this.deps.threadStore.getByCurrentMentionId(e.mentionId);
    if (!thread || thread.isTerminal || thread.status !== 'waiting') return;
    thread.markRunning();
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
  }

  private async onComment(e: AnyDomainEvent): Promise<void> {
    if (e.type !== 'comment.posted' || e.authorType !== 'user') return;
    const comment = await this.deps.commentStore.getById(e.commentId);
    if (!comment?.threadId) return;
    const thread = await this.deps.threadStore.getById(comment.threadId);
    if (!thread || thread.isTerminal) return;
    // A user re-mention of the thread's persona already counted through the
    // route's `openTurn`; only a plain reply is counted here.
    if (e.createdMentions.some((m) => m.targetAgent === thread.personaName)) return;
    thread.recordTurn();
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
  }
}
