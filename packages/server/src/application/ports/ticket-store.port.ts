import type { TicketStatus, TicketLinkType } from '@fleex/shared';

import type { BoardEntity } from '../../domain/entities/board.entity.js';
import type { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';

export interface TicketStorePort {
  // Boards
  getAllBoards(): Promise<BoardEntity[]>;
  getBoardById(id: string): Promise<BoardEntity | null>;
  saveBoard(board: BoardEntity): Promise<void>;
  removeBoard(id: string): Promise<void>;

  // Tickets
  getAllTickets(): Promise<TicketEntity[]>;
  getTicketById(id: string): Promise<TicketEntity | null>;
  /**
   * Look up a ticket by its globally-unique display id.
   * Spans archived tickets (like `getTicketById`, unlike `getAllTickets`), so
   * callers such as `ticket unarchive` can resolve a ticket by the id shown to
   * the user even after it has been archived.
   */
  getTicketByDisplayId(displayId: number): Promise<TicketEntity | null>;
  getTicketsByBoard(boardId: string): Promise<TicketEntity[]>;
  getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]>;
  getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]>;
  /**
   * Insert a brand-new ticket and assign a globally-unique display_id.
   * Mutates `ticket.displayId` in place with the DB-assigned value.
   * Use `saveTicket` for updates of existing tickets.
   */
  createTicket(ticket: TicketEntity): Promise<void>;
  saveTicket(ticket: TicketEntity): Promise<void>;
  removeTicket(id: string): Promise<void>;
  removeTicketsByBoard(boardId: string): Promise<void>;

  // Archive
  getArchivedTickets(boardId?: string, limit?: number, offset?: number): Promise<TicketEntity[]>;
  countArchivedTickets(boardId?: string): Promise<number>;

  // Agent queries
  getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null>;
  getClaimedByAgent(agentName: string): Promise<TicketEntity[]>;

  // Activity
  saveActivity(entry: TicketActivityEntity): Promise<void>;
  getActivitiesByTicket(ticketId: string, limit?: number): Promise<TicketActivityEntity[]>;
  searchTicketsByActivityFilters(options: {
    since?: Date;
    until?: Date;
    action?: string;
    limit?: number;
  }): Promise<TicketActivityEntity[]>;
}
