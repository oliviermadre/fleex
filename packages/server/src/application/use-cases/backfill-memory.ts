import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { TicketGroupStorePort } from '../ports/ticket-group-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import {
  chunkCommentThread,
  chunkDeliverable,
  chunkEpic,
  chunkPersona,
  chunkScratchpad,
  chunkSkill,
  chunkTicket,
} from '../memory/chunker.js';
import type { MemoryKernel, IngestOutcome } from '../memory/memory-kernel.js';
import type { MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';
import type { KvStorePort } from '../ports/kv-store.port.js';

/** KV prefix every scratchpad is stored under. */
const SCRATCHPAD_PREFIX = 'scratchpad:';

/** Key of the one note that belongs to no repository. */
const GLOBAL_SCRATCHPAD_KEY = '__global__';

/**
 * Kinds a full walk is authoritative for, and may therefore prune.
 *
 * `qa_pair`, `execution_trace`, `curated_note` and `assistant_conversation` are
 * absent on purpose: nothing walks them, so every one of them would look orphaned.
 */
const PRUNABLE_KINDS: readonly MemorySourceKind[] = [
  'ticket', 'comment_thread', 'deliverable', 'ticket_summary', 'cli_session_summary',
  'persona', 'skill', 'epic', 'scratchpad',
];

export interface BackfillProgress {
  tickets: number;
  commentThreads: number;
  deliverables: number;
  personas: number;
  skills: number;
  epics: number;
  notes: number;
  /** Chunks dropped because their source no longer exists. */
  pruned: number;
  chunksEmbedded: number;
  chunksUnchanged: number;
  chunksDeferred: number;
  errors: number;
}

const EMPTY: BackfillProgress = {
  tickets: 0, commentThreads: 0, deliverables: 0, personas: 0, skills: 0, epics: 0, notes: 0,
  pruned: 0,
  chunksEmbedded: 0, chunksUnchanged: 0, chunksDeferred: 0, errors: 0,
};

/**
 * Index the corpus that already exists.
 *
 * An event-driven pipeline only ever sees content that changes *after* it is
 * wired, which for an instance with six months of history means an index that
 * describes almost nothing. This walks what is already there.
 *
 * Safe to re-run: the kernel compares content hashes, so a second pass embeds
 * nothing and a pass interrupted halfway resumes rather than starting over. That
 * is what makes it usable as a plain "reindex" button instead of a one-shot
 * migration.
 */
export class BackfillMemoryUseCase {
  constructor(
    private readonly kernel: MemoryKernel,
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly deliverableStore: DeliverableStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly skillStore: SkillStorePort,
    private readonly logger: LoggerPort,
    /** Epics. Absent on drivers with no epic store. */
    private readonly ticketGroupStore?: TicketGroupStorePort | null,
    /** Where notes live. Absent on the filesystem fallback. */
    private readonly kvStore?: KvStorePort | null,
  ) {}

  async execute(): Promise<BackfillProgress> {
    const progress: BackfillProgress = { ...EMPTY };
    const started = Date.now();
    // What exists right now, per kind. Compared against the index at the end so a
    // source deleted while nothing was listening does not keep answering queries.
    const live = new Map<MemorySourceKind, Set<string>>();
    const seen = (kind: MemorySourceKind, id: string): void => {
      const set = live.get(kind);
      if (set) set.add(id);
      else live.set(kind, new Set([id]));
    };

    const tickets = await this.ticketStore.getAllTickets();
    // Repo affinity is a scoring signal, so it has to be resolved per ticket
    // rather than left null — a note about the repo you are in should outrank an
    // equally similar one from elsewhere.
    const repoByTicket = new Map(tickets.map((t) => [t.id, primaryRepo(t)]));

    for (const ticket of tickets) {
      seen('ticket', ticket.id);
      seen('comment_thread', ticket.id);
      await this.step(progress, 'ticket', ticket.id, async () => {
        const outcome = await this.kernel.ingest('ticket', ticket.id, chunkTicket({
          id: ticket.id,
          displayId: ticket.displayId,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          boardId: ticket.boardId,
          tags: ticket.tags,
          repo: repoByTicket.get(ticket.id) ?? null,
          updatedAt: ticket.updatedAt,
        }));
        progress.tickets++;
        return outcome;
      });

      await this.step(progress, 'comment_thread', ticket.id, async () => {
        const comments = await this.commentStore.getByTicket(ticket.id);
        // Private comments are addressed to specific agents; indexing them would
        // leak them into any other agent's retrieved context.
        const visible = comments.filter((c) => c.visibility === 'public');
        const outcome = await this.kernel.ingest('comment_thread', ticket.id, chunkCommentThread(
          {
            id: ticket.id,
            displayId: ticket.displayId,
            title: ticket.title,
            boardId: ticket.boardId,
            tags: ticket.tags,
            repo: repoByTicket.get(ticket.id) ?? null,
          },
          visible.map((c) => ({
            id: c.id,
            authorName: c.authorName,
            authorType: c.authorType,
            body: c.body,
            createdAt: c.createdAt,
          })),
        ));
        if (visible.length > 0) progress.commentThreads++;
        return outcome;
      });
    }

    const ticketById = new Map(tickets.map((t) => [t.id, t]));
    for (const deliverable of await this.deliverableStore.getAll()) {
      await this.step(progress, 'deliverable', deliverable.id, async () => {
        const ticket = deliverable.ticketId ? ticketById.get(deliverable.ticketId) : undefined;
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
        // A deliverable maps onto one of three source kinds depending on its
        // type; ingesting under the wrong one would orphan the previous rows.
        const kind = drafts[0]?.sourceKind ?? 'deliverable';
        seen(kind, deliverable.id);
        const outcome = await this.kernel.ingest(kind, deliverable.id, drafts);
        progress.deliverables++;
        return outcome;
      });
    }

    for (const persona of await this.personaStore.getAll()) {
      seen('persona', persona.id);
      await this.step(progress, 'persona', persona.id, async () => {
        const outcome = await this.kernel.ingest('persona', persona.id, chunkPersona({
          id: persona.id,
          name: persona.name,
          memoryMd: persona.memoryMd,
          identityMd: persona.identityMd,
          updatedAt: persona.updatedAt,
        }));
        progress.personas++;
        return outcome;
      });
    }

    for (const skill of await this.skillStore.getAll()) {
      seen('skill', skill.id);
      await this.step(progress, 'skill', skill.id, async () => {
        const outcome = await this.kernel.ingest('skill', skill.id, chunkSkill({
          id: skill.id,
          commandName: skill.commandName,
          displayName: skill.displayName,
          markdownContent: skill.markdownContent,
          updatedAt: skill.updatedAt,
        }));
        progress.skills++;
        return outcome;
      });
    }

    // Epics last: they are the fewest and the cheapest, so a run interrupted
    // partway has still covered the bulk of the corpus.
    for (const epic of await this.ticketGroupStore?.getAllTicketGroups() ?? []) {
      seen('epic', epic.id);
      await this.step(progress, 'epic', epic.id, async () => {
        const outcome = await this.kernel.ingest('epic', epic.id, chunkEpic({
          id: epic.id,
          name: epic.name,
          description: epic.description,
          boardId: epic.boardIds[0] ?? null,
          updatedAt: epic.updatedAt,
        }));
        progress.epics++;
        return outcome;
      });
    }

    // Notes. Indexed on edit by the listener, which means an instance that opted
    // in after writing them would never index the ones it already had — the exact
    // case a backfill exists for.
    for (const entry of await this.kvStore?.listByPrefix(SCRATCHPAD_PREFIX) ?? []) {
      const key = entry.key.slice(SCRATCHPAD_PREFIX.length);
      seen('scratchpad', key);
      await this.step(progress, 'scratchpad', key, async () => {
        const outcome = await this.kernel.ingest('scratchpad', key, chunkScratchpad({
          key,
          label: key === GLOBAL_SCRATCHPAD_KEY ? 'Global' : key,
          content: entry.value,
          repo: key === GLOBAL_SCRATCHPAD_KEY ? null : key,
        }));
        progress.notes++;
        return outcome;
      });
    }

    progress.pruned = await this.pruneOrphans(live);

    this.logger.info('Memory backfill finished', { ...progress, durationMs: Date.now() - started });
    return progress;
  }

  /**
   * Drop indexed sources that no longer exist.
   *
   * Only the kinds this walk is authoritative for. Derived kinds — a distilled run
   * trace, a Q&A pair, a note kept by hand, a conversation digest — are deliberately
   * left alone: their source is an execution or a mention that may well be gone,
   * and the memory is the point of them, not a cache of something else.
   */
  private async pruneOrphans(live: Map<MemorySourceKind, Set<string>>): Promise<number> {
    let pruned = 0;
    for (const kind of PRUNABLE_KINDS) {
      const present = live.get(kind) ?? new Set<string>();
      // An empty walk means the store was unreadable rather than empty; pruning on
      // that would delete the whole index on a transient failure.
      if (present.size === 0) continue;

      try {
        for (const sourceId of await this.kernel.listSourceIds(kind)) {
          if (present.has(sourceId)) continue;
          await this.kernel.forget(kind, sourceId);
          pruned++;
        }
      } catch (error) {
        this.logger.warn('Could not prune orphaned memory chunks', {
          kind, error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (pruned > 0) this.logger.info('Pruned orphaned memory chunks', { chunks: pruned });
    return pruned;
  }

  /**
   * Run one ingestion and fold its counters in.
   *
   * Per-source error isolation on purpose: one malformed deliverable must not
   * abandon the remaining thousand. Failures are counted and logged so a
   * systematically broken source is visible rather than silently skipped.
   */
  private async step(
    progress: BackfillProgress,
    kind: string,
    id: string,
    work: () => Promise<IngestOutcome>,
  ): Promise<void> {
    try {
      const outcome = await work();
      progress.chunksEmbedded += outcome.embedded;
      progress.chunksUnchanged += outcome.unchanged;
      progress.chunksDeferred += outcome.deferred;
    } catch (error) {
      progress.errors++;
      this.logger.warn('Memory backfill skipped a source', {
        kind, id, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** First linked repository of a ticket, used as its repo affinity for scoring. */
function primaryRepo(ticket: TicketEntity): string | null {
  return ticket.links.find((l) => l.type === 'repository')?.ref ?? null;
}
