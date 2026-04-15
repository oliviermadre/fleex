import type { TicketStatus, TicketLinkType } from '@fleex/shared';
import type { BoardEntity } from '../../domain/entities/board.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';

/**
 * Write-through in-memory cache over any TicketStorePort.
 * Hot path (getAll, getById, getByBoard) never touches the DB.
 * Activity queries still go to the inner store (infrequent, not on hot path).
 */
export class CachedTicketStore implements TicketStorePort {
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
    return this.tickets.get(id) ?? null;
  }

  async getTicketsByBoard(boardId: string): Promise<TicketEntity[]> {
    await this.ensureWarmed();
    return [...this.tickets.values()].filter((t) => t.boardId === boardId && t.archivedAt === null);
  }

  async getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]> {
    await this.ensureWarmed();
    return [...this.tickets.values()].filter((t) => t.boardId === boardId && t.status === status && t.archivedAt === null);
  }

  async getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]> {
    await this.ensureWarmed();
    return [...this.tickets.values()].filter((t) =>
      t.links.some((l) => l.type === type && l.ref === ref),
    );
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

  // ── Remote sync: reload a single entity from DB into cache ──

  async reloadTicket(id: string): Promise<TicketEntity | null> {
    const ticket = await this.inner.getTicketById(id);
    if (ticket) {
      this.tickets.set(id, ticket);
    } else {
      this.tickets.delete(id);
    }
    return ticket;
  }

  async reloadBoard(id: string): Promise<BoardEntity | null> {
    const board = await this.inner.getBoardById(id);
    if (board) {
      this.boards.set(id, board);
    } else {
      this.boards.delete(id);
    }
    return board;
  }

  evictTicket(id: string): void {
    this.tickets.delete(id);
  }

  evictBoard(id: string): void {
    this.boards.delete(id);
  }

  evictTicketsByBoard(boardId: string): void {
    for (const [id, t] of this.tickets) {
      if (t.boardId === boardId) this.tickets.delete(id);
    }
  }

  // ── Archive ──

  async getArchivedTickets(boardId?: string, limit?: number, offset?: number): Promise<TicketEntity[]> {
    return this.inner.getArchivedTickets(boardId, limit, offset);
  }

  async countArchivedTickets(boardId?: string): Promise<number> {
    return this.inner.countArchivedTickets(boardId);
  }

  // ── Passthrough (not on hot path) ──

  async getNextDisplayId(boardId: string): Promise<number> {
    return this.inner.getNextDisplayId(boardId);
  }

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
