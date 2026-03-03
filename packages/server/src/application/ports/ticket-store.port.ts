import type { TicketStatus, TicketLinkType } from '@asm/shared';
import type { BoardEntity } from '../../domain/entities/board.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';

export interface TicketStorePort {
  // Boards
  getAllBoards(): Promise<BoardEntity[]>;
  getBoardById(id: string): Promise<BoardEntity | null>;
  saveBoard(board: BoardEntity): Promise<void>;
  removeBoard(id: string): Promise<void>;

  // Tickets
  getAllTickets(): Promise<TicketEntity[]>;
  getTicketById(id: string): Promise<TicketEntity | null>;
  getTicketsByBoard(boardId: string): Promise<TicketEntity[]>;
  getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]>;
  getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]>;
  saveTicket(ticket: TicketEntity): Promise<void>;
  removeTicket(id: string): Promise<void>;
  removeTicketsByBoard(boardId: string): Promise<void>;

  // Display ID
  getNextDisplayId(boardId: string): Promise<number>;

  // Agent queries
  getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null>;
  getClaimedByAgent(agentName: string): Promise<TicketEntity[]>;

  // Activity
  saveActivity(entry: TicketActivityEntity): Promise<void>;
  getActivitiesByTicket(ticketId: string, limit?: number): Promise<TicketActivityEntity[]>;
}
