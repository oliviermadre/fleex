import type { TicketStatus, TicketLinkType } from '@asm/shared';
import type { BoardEntity } from '../../domain/entities/board.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';

export interface TicketStorePort {
  // Boards
  getAllBoards(): BoardEntity[];
  getBoardById(id: string): BoardEntity | null;
  saveBoard(board: BoardEntity): Promise<void>;
  removeBoard(id: string): Promise<void>;

  // Tickets
  getAllTickets(): TicketEntity[];
  getTicketById(id: string): TicketEntity | null;
  getTicketsByBoard(boardId: string): TicketEntity[];
  getTicketsByStatus(boardId: string, status: TicketStatus): TicketEntity[];
  getTicketsLinkedTo(type: TicketLinkType, ref: string): TicketEntity[];
  saveTicket(ticket: TicketEntity): Promise<void>;
  removeTicket(id: string): Promise<void>;
  removeTicketsByBoard(boardId: string): Promise<void>;

  // Agent queries
  getNextTicketForAgent(boardId?: string): TicketEntity | null;
  getClaimedByAgent(agentName: string): TicketEntity[];

  // Activity
  saveActivity(entry: TicketActivityEntity): Promise<void>;
  getActivitiesByTicket(ticketId: string, limit?: number): TicketActivityEntity[];
}
