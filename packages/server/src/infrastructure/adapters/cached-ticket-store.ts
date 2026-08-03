import type { TicketStatus, TicketLinkType } from '@fleex/shared';

import type { RemoteCacheSync } from '../../application/ports/remote-cache-sync.port.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';
import type { BoardEntity } from '../../domain/entities/board.entity.js';
import type { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { AnyDomainEvent } from '../../domain/events.js';

/**
 * Write-through in-memory cache over any TicketStorePort.
 * Hot path (getAll, getById, getByBoard) never touches the DB.
 * Activity queries still go to the inner store (infrequent, not on hot path).
 */
export class CachedTicketStore implements TicketStorePort, RemoteCacheSync {
  private tickets = new Map<string, TicketEntity>();
  private boards = new Map<string, BoardEntity>();
  private warmedUp = false;

  constructor(private readonly inner: TicketStorePort) {}

  async warmUp(): Promise<void> {
    const [allTickets, allBoards] = await Promise.all([
      this.inner.getAllTickets(),
      this.inner.getAllBoards(),
    ]);
    this.tickets.clear();
    this.boards.clear();
    for (const t of allTickets) this.tickets.set(t.id, t);
    for (const b of allBoards) this.boards.set(b.id, b);
    this.warmedUp = true;
  }

  private async ensureWarmed(): Promise<void> {
    if (!this.warmedUp) await this.warmUp();
  }

  // ── Cross-instance cache coherence (RemoteCacheSync) ──
  // A sibling instance wrote tickets/boards to the shared store and forwarded
  // the event over the hub. Our write-through cache never saw that write, so we
  // re-read the touched entity from source (updating or evicting the entry)
  // before the event is broadcast to UI clients.

  async applyRemoteEvent(event: AnyDomainEvent): Promise<void> {
    // Only the entity's own events mutate it. comment/mention/deliverable
    // events also carry a ticketId, but as a reference — the ticket itself is
    // unchanged, so re-reading it would be a wasted query.
    if (event.type.startsWith('ticket.') && 'ticketId' in event) {
      await this.refreshTicket((event as { ticketId: string }).ticketId);
    } else if (event.type.startsWith('board.') && 'boardId' in event) {
      await this.refreshBoard((event as { boardId: string }).boardId);
    }
  }

  private async refreshTicket(id: string): Promise<void> {
    const fresh = await this.inner.getTicketById(id);
    if (fresh) this.tickets.set(id, fresh);
    else this.tickets.delete(id);
  }

  private async refreshBoard(id: string): Promise<void> {
    const fresh = await this.inner.getBoardById(id);
    if (fresh) this.boards.set(id, fresh);
    else this.boards.delete(id);
  }

  // ── Boards ──

  async getAllBoards(): Promise<BoardEntity[]> {
    await this.ensureWarmed();
    return [...this.boards.values()];
  }

  async getBoardById(id: string): Promise<BoardEntity | null> {
    await this.ensureWarmed();
    return this.boards.get(id) ?? null;
  }

  async saveBoard(board: BoardEntity): Promise<void> {
    await this.inner.saveBoard(board);
    this.boards.set(board.id, board);
  }

  async removeBoard(id: string): Promise<void> {
    await this.inner.removeBoard(id);
    this.boards.delete(id);
  }

  // ── Tickets ──

  async getAllTickets(): Promise<TicketEntity[]> {
    await this.ensureWarmed();
    return [...this.tickets.values()].filter((t) => t.archivedAt === null);
  }

  async getTicketById(id: string): Promise<TicketEntity | null> {
    await this.ensureWarmed();
    const cached = this.tickets.get(id);
    if (cached) return cached;
    // The cache is warmed from getAllTickets(), which excludes archived tickets,
    // so a miss may be an archived ticket rather than a non-existent one. Fall
    // back to the source of truth (which spans archived) and memoise it, keeping
    // the cache transparent. Archived entries stay filtered out of getAllTickets
    // by their archivedAt, so this never leaks them into the Kanban view.
    const fresh = await this.inner.getTicketById(id);
    if (fresh) this.tickets.set(fresh.id, fresh);
    return fresh;
  }

  async getTicketByDisplayId(displayId: number): Promise<TicketEntity | null> {
    await this.ensureWarmed();
    const cached = [...this.tickets.values()].find((t) => t.displayId === displayId);
    if (cached) return cached;
    // Not in the (active-only) cache — could be an archived ticket. Resolve via
    // the source of truth and memoise, mirroring getTicketById above.
    const fresh = await this.inner.getTicketByDisplayId(displayId);
    if (fresh) this.tickets.set(fresh.id, fresh);
    return fresh;
  }

  async getTicketsByBoard(boardId: string): Promise<TicketEntity[]> {
    await this.ensureWarmed();
    return [...this.tickets.values()].filter((t) => t.boardId === boardId && t.archivedAt === null);
  }

  async getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]> {
    await this.ensureWarmed();
    return [...this.tickets.values()].filter(
      (t) => t.boardId === boardId && t.status === status && t.archivedAt === null,
    );
  }

  async getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]> {
    await this.ensureWarmed();
    return [...this.tickets.values()].filter((t) =>
      t.links.some((l) => l.type === type && l.ref === ref),
    );
  }

  async createTicket(ticket: TicketEntity): Promise<void> {
    await this.inner.createTicket(ticket);
    // inner.createTicket has mutated ticket.displayId — cache the now-complete entity
    this.tickets.set(ticket.id, ticket);
  }

  async saveTicket(ticket: TicketEntity): Promise<void> {
    await this.inner.saveTicket(ticket);
    this.tickets.set(ticket.id, ticket);
  }

  async removeTicket(id: string): Promise<void> {
    await this.inner.removeTicket(id);
    this.tickets.delete(id);
  }

  async removeTicketsByBoard(boardId: string): Promise<void> {
    await this.inner.removeTicketsByBoard(boardId);
    for (const [id, t] of this.tickets) {
      if (t.boardId === boardId) this.tickets.delete(id);
    }
  }

  // ── Archive ──

  async getArchivedTickets(
    boardId?: string,
    limit?: number,
    offset?: number,
  ): Promise<TicketEntity[]> {
    return this.inner.getArchivedTickets(boardId, limit, offset);
  }

  async countArchivedTickets(boardId?: string): Promise<number> {
    return this.inner.countArchivedTickets(boardId);
  }

  // ── Passthrough (not on hot path) ──

  async getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null> {
    return this.inner.getNextTicketForAgent(boardId);
  }

  async getClaimedByAgent(agentName: string): Promise<TicketEntity[]> {
    return this.inner.getClaimedByAgent(agentName);
  }

  async saveActivity(entry: TicketActivityEntity): Promise<void> {
    return this.inner.saveActivity(entry);
  }

  async getActivitiesByTicket(ticketId: string, limit?: number): Promise<TicketActivityEntity[]> {
    return this.inner.getActivitiesByTicket(ticketId, limit);
  }

  async searchTicketsByActivityFilters(options: {
    since?: Date;
    until?: Date;
    action?: string;
    limit?: number;
  }): Promise<TicketActivityEntity[]> {
    return this.inner.searchTicketsByActivityFilters(options);
  }
}
