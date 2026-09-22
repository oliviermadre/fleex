import type { EventBus } from './event-bus.js';
import type { ThreadStorePort } from './ports/thread-store.port.js';
import type { CommentStorePort } from './ports/comment-store.port.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { RunAssistantTurnUseCase } from './use-cases/run-assistant-turn.js';
import type { AnyDomainEvent } from '../domain/events.js';

export interface AssistantThreadListenerDeps {
  eventBus: EventBus;
  threadStore: ThreadStorePort;
  commentStore: CommentStorePort;
  runAssistantTurn: Pick<RunAssistantTurnUseCase, 'execute'>;
  logger: LoggerPort;
}

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
  }

  private async onMention(e: AnyDomainEvent, status: 'resolved' | 'waiting_for_info' | 'failed'): Promise<void> {
    if (!('mentionId' in e)) return;
    const thread = await this.deps.threadStore.getByCurrentMentionId(e.mentionId);
    if (!thread || thread.isTerminal) return;
    if (status === 'failed') {
      thread.fail();
    } else {
      thread.recordTurn();
      if (status === 'resolved') thread.clearFailures();
      if (status === 'waiting_for_info') thread.markWaiting();
      else thread.markRunning();
    }
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
    await this.deps.runAssistantTurn.execute({
      ticketId: thread.ticketId,
      trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: status },
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
