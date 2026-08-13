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
  chunkSkill,
  chunkTicket,
} from '../memory/chunker.js';
import type { MemoryKernel, IngestOutcome } from '../memory/memory-kernel.js';

export interface BackfillProgress {
  tickets: number;
  commentThreads: number;
  deliverables: number;
  personas: number;
  skills: number;
  epics: number;
  chunksEmbedded: number;
  chunksUnchanged: number;
  chunksDeferred: number;
  errors: number;
}

const EMPTY: BackfillProgress = {
  tickets: 0, commentThreads: 0, deliverables: 0, personas: 0, skills: 0, epics: 0,
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
  ) {}

  async execute(): Promise<BackfillProgress> {
    const progress: BackfillProgress = { ...EMPTY };
    const started = Date.now();

    const tickets = await this.ticketStore.getAllTickets();
    // Repo affinity is a scoring signal, so it has to be resolved per ticket
    // rather than left null — a note about the repo you are in should outrank an
    // equally similar one from elsewhere.
    const repoByTicket = new Map(tickets.map((t) => [t.id, primaryRepo(t)]));

    for (const ticket of tickets) {
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
        const outcome = await this.kernel.ingest(kind, deliverable.id, drafts);
        progress.deliverables++;
        return outcome;
      });
    }

    for (const persona of await this.personaStore.getAll()) {
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

    this.logger.info('Memory backfill finished', { ...progress, durationMs: Date.now() - started });
    return progress;
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
