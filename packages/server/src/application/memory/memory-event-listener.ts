import type {
  CommentDeletedEvent,
  CommentPostedEvent,
  CommentUpdatedEvent,
  DeliverableCreatedEvent,
  DeliverableDeletedEvent,
  DeliverableUpdatedEvent,
  ScratchpadUpdatedEvent,
  TicketDeletedEvent,
} from '../../domain/events.js';
import type { EventBus } from '../event-bus.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { KvStorePort } from '../ports/kv-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';
import {
  chunkCommentThread,
  chunkDeliverable,
  chunkPersona,
  chunkScratchpad,
  chunkSkill,
  chunkTicket,
} from './chunker.js';
import type { MemoryKernel } from './memory-kernel.js';

/**
 * Trailing debounce, per source.
 *
 * Editing a description fires `ticket.updated` on nearly every keystroke, and a
 * conversation fires `comment.posted` repeatedly within seconds. Re-chunking on
 * each one would embed text that is about to be replaced. Two seconds is long
 * enough to coalesce a burst and short enough that memory feels current.
 */
const DEBOUNCE_MS = 2_000;

export interface MemoryEventListenerDeps {
  bus: EventBus;
  kernel: MemoryKernel;
  config: ConfigPort;
  ticketStore: TicketStorePort;
  commentStore: CommentStorePort;
  deliverableStore: DeliverableStorePort;
  personaStore: PersonaStorePort;
  skillStore: SkillStorePort;
  /** Where scratchpads live. Null on the filesystem fallback. */
  kvStore?: KvStorePort | null;
  logger: LoggerPort;
}

/**
 * The subset of a ticket event this listener reads. Every ticket event carries
 * `ticketId`; nothing else here is needed, and narrowing keeps the handler
 * usable for all of them without a union that would have to track new members.
 */
interface TicketIdEvent { ticketId: string }

/** One queued re-index, identified by what it will replace. */
interface PendingJob {
  sourceKind: MemorySourceKind;
  sourceId: string;
  run: () => Promise<void>;
}

/**
 * Keeps the retrieval index current by re-indexing whatever a domain event
 * touched.
 *
 * A sibling of `DomainEventListener` rather than an extension of it: that class
 * is already the orchestration engine for agent triggering and workflow
 * advancement, and folding a second concern into it would mean a chunker failure
 * shares a blast radius with mention dispatch.
 *
 * Registered on the **local** bus only. Ingestion is a side-effect, and each
 * instance owns its own index — subscribing to hub-relayed events would make
 * every instance re-embed every other instance's writes.
 *
 * Domain event payloads are id-only, so every handler re-fetches from the
 * stores. That is not a workaround: it means the index always reflects committed
 * state rather than a payload snapshot that may already be stale.
 */
export class MemoryEventListener {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, PendingJob>();

  constructor(private readonly deps: MemoryEventListenerDeps) {}

  /**
   * Subscribe to the events that change indexable content.
   *
   * Deliberately does **not** call `bus.onError`: the bus keeps a single error
   * handler, and claiming it here would silence the logging `DomainEventListener`
   * installed. Each job carries its own try/catch instead.
   */
  register(): void {
    const { bus } = this.deps;

    for (const type of ['ticket.created', 'ticket.updated', 'ticket.tagsChanged'] as const) {
      bus.on(type, (e) => this.onTicketChanged(e as TicketIdEvent));
    }
    // `ticket.moved` is deliberately absent: a status change alters no indexed
    // text and no scoring metadata, so re-chunking on it would be pure cost.
    bus.on('ticket.deleted', (e) => this.onTicketDeleted(e as TicketDeletedEvent));

    bus.on('comment.posted', (e) => this.onCommentChanged((e as CommentPostedEvent).ticketId));
    bus.on('comment.updated', (e) => this.onCommentChanged((e as CommentUpdatedEvent).ticketId));
    bus.on('comment.deleted', (e) => this.onCommentChanged((e as CommentDeletedEvent).ticketId));

    bus.on('deliverable.created', (e) => this.onDeliverableChanged((e as DeliverableCreatedEvent).deliverableId));
    bus.on('deliverable.updated', (e) => this.onDeliverableChanged((e as DeliverableUpdatedEvent).deliverableId));
    bus.on('deliverable.deleted', (e) => this.onDeliverableDeleted(e as DeliverableDeletedEvent));

    for (const type of ['persona.created', 'persona.updated'] as const) {
      bus.on(type, (e) => this.onPersonaChanged((e as { personaId: string }).personaId));
    }
    bus.on('persona.deleted', (e) => this.forget('persona', (e as { personaId: string }).personaId));

    for (const type of ['skill.created', 'skill.updated'] as const) {
      bus.on(type, (e) => this.onSkillChanged((e as { skillId: string }).skillId));
    }
    bus.on('skill.deleted', (e) => this.forget('skill', (e as { skillId: string }).skillId));

    bus.on('scratchpad.updated', (e) => this.onScratchpadChanged(e as ScratchpadUpdatedEvent));

    this.deps.logger.info('Memory event listener registered');
  }

  /** Cancel queued work. Called on shutdown so timers cannot outlive the process. */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  // ─── Handlers ───

  private onTicketChanged(event: TicketIdEvent): void {
    this.enqueue('ticket', event.ticketId, async () => {
      const ticket = await this.deps.ticketStore.getTicketById(event.ticketId);
      // Deleted between the event and the drain: the delete handler will have
      // cleaned up, so there is nothing to do.
      if (!ticket) return;
      await this.deps.kernel.ingest('ticket', ticket.id, chunkTicket(this.ticketInput(ticket)));
    });

    // A ticket's tags, board and repo are copied onto its comment chunks for
    // scoring, so those have to be refreshed too — otherwise a retagged ticket
    // keeps scoring its discussion against the old tags.
    this.onCommentChanged(event.ticketId);
  }

  private onTicketDeleted(event: TicketDeletedEvent): void {
    this.enqueue('ticket', event.ticketId, async () => {
      await this.deps.kernel.forget('ticket', event.ticketId);
      await this.deps.kernel.forget('comment_thread', event.ticketId);
    });
  }

  private onCommentChanged(ticketId: string): void {
    this.enqueue('comment_thread', ticketId, async () => {
      const ticket = await this.deps.ticketStore.getTicketById(ticketId);
      if (!ticket) return;
      const comments = await this.deps.commentStore.getByTicket(ticketId);
      // Private comments are addressed to named agents; indexing them would
      // surface them in another agent's retrieved context.
      const visible = comments.filter((c) => c.visibility === 'public');
      await this.deps.kernel.ingest('comment_thread', ticketId, chunkCommentThread(
        {
          id: ticket.id,
          displayId: ticket.displayId,
          title: ticket.title,
          boardId: ticket.boardId,
          tags: ticket.tags,
          repo: primaryRepo(ticket),
        },
        visible.map((c) => ({
          id: c.id,
          authorName: c.authorName,
          authorType: c.authorType,
          body: c.body,
          createdAt: c.createdAt,
        })),
      ));
    });
  }

  private onDeliverableChanged(deliverableId: string): void {
    this.enqueue('deliverable', deliverableId, async () => {
      const deliverable = await this.deps.deliverableStore.getById(deliverableId);
      if (!deliverable) return;

      const ticket = deliverable.ticketId
        ? await this.deps.ticketStore.getTicketById(deliverable.ticketId)
        : null;

      const drafts = chunkDeliverable({
        id: deliverable.id,
        title: deliverable.title,
        type: deliverable.type,
        content: deliverable.content,
        agentName: deliverable.agentName,
        ticketId: deliverable.ticketId,
        boardId: ticket?.boardId ?? null,
        repo: ticket ? primaryRepo(ticket) : null,
        tags: ticket?.tags ?? [],
        updatedAt: deliverable.updatedAt,
        originLabel: ticket?.title ?? null,
      });

      // The type decides the source kind. A retype (`deliverable.updated` carries
      // oldType/newType) therefore moves the rows, so the previous kinds are
      // cleared before writing — otherwise the old chunks keep answering queries.
      const kind = drafts[0]?.sourceKind ?? 'deliverable';
      for (const stale of DELIVERABLE_KINDS) {
        if (stale !== kind) await this.deps.kernel.forget(stale, deliverable.id);
      }
      await this.deps.kernel.ingest(kind, deliverable.id, drafts);
    });
  }

  private onDeliverableDeleted(event: DeliverableDeletedEvent): void {
    this.enqueue('deliverable', event.deliverableId, async () => {
      // The type is gone with the row, so every kind it could have been is cleared.
      for (const kind of DELIVERABLE_KINDS) {
        await this.deps.kernel.forget(kind, event.deliverableId);
      }
    });
  }

  private onPersonaChanged(personaId: string): void {
    this.enqueue('persona', personaId, async () => {
      const persona = await this.deps.personaStore.getById(personaId);
      if (!persona) return;
      await this.deps.kernel.ingest('persona', persona.id, chunkPersona({
        id: persona.id,
        name: persona.name,
        memoryMd: persona.memoryMd,
        identityMd: persona.identityMd,
        updatedAt: persona.updatedAt,
      }));
    });
  }

  private onSkillChanged(skillId: string): void {
    this.enqueue('skill', skillId, async () => {
      const skill = await this.deps.skillStore.getById(skillId);
      if (!skill) return;
      await this.deps.kernel.ingest('skill', skill.id, chunkSkill({
        id: skill.id,
        commandName: skill.commandName,
        displayName: skill.displayName,
        markdownContent: skill.markdownContent,
        updatedAt: skill.updatedAt,
      }));
    });
  }

  private onScratchpadChanged(event: ScratchpadUpdatedEvent): void {
    this.enqueue('scratchpad', event.key, async () => {
      const kvStore = this.deps.kvStore;
      // Scratchpads live in the KV store; without one (the filesystem fallback)
      // there is nothing to read back here, so ingestion waits for a backfill.
      if (!kvStore) return;

      const content = await kvStore.get(`scratchpad:${event.key}`);
      await this.deps.kernel.ingest('scratchpad', event.key, chunkScratchpad({
        key: event.key,
        label: event.key === '__global__' ? 'Global' : event.key,
        content: content ?? '',
        repo: event.repo,
        updatedAt: event.occurredAt,
      }));
    });
  }

  private forget(sourceKind: MemorySourceKind, sourceId: string): void {
    this.enqueue(sourceKind, sourceId, () => this.deps.kernel.forget(sourceKind, sourceId));
  }

  // ─── Queue ───

  /**
   * Queue a job, replacing any job already pending for the same source.
   *
   * Replacing rather than appending is the point: three edits to one description
   * should produce one re-index of the final text, not three of intermediate
   * states. The engine is checked here, at enqueue time, because `memoryEngine`
   * is mutable at runtime — an instance that has never opted in must pay nothing.
   */
  private enqueue(sourceKind: MemorySourceKind, sourceId: string, run: () => Promise<void>): void {
    if (this.deps.config.get().memoryEngine !== 'semantic') return;

    const key = `${sourceKind}:${sourceId}`;
    this.pending.set(key, { sourceKind, sourceId, run });

    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(key, setTimeout(() => void this.drain(key), DEBOUNCE_MS));
  }

  private async drain(key: string): Promise<void> {
    this.timers.delete(key);
    const job = this.pending.get(key);
    if (!job) return;
    this.pending.delete(key);

    try {
      await job.run();
    } catch (error) {
      // Ingestion is best-effort: a source that cannot be indexed must not take
      // down the request that changed it, nor the rest of the queue.
      this.deps.logger.warn('Memory ingestion failed for a source', {
        sourceKind: job.sourceKind,
        sourceId: job.sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private ticketInput(ticket: TicketEntity) {
    return {
      id: ticket.id,
      displayId: ticket.displayId,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      boardId: ticket.boardId,
      tags: ticket.tags,
      repo: primaryRepo(ticket),
      updatedAt: ticket.updatedAt,
    };
  }
}

/** The kinds a deliverable can be indexed under, depending on its type. */
const DELIVERABLE_KINDS: MemorySourceKind[] = ['deliverable', 'ticket_summary', 'cli_session_summary'];

/** First linked repository of a ticket, used as its repo affinity for scoring. */
function primaryRepo(ticket: TicketEntity): string | null {
  return ticket.links.find((l) => l.type === 'repository')?.ref ?? null;
}
