import type { TicketTodoEvent } from '@fleex/shared';
import type { TicketTodoItemEntity } from '../../domain/entities/ticket-todo-item.entity.js';

export interface TodoStorePort {
  /** A ticket's live items (not deleted), by position then ref. */
  listItems(ticketId: string): Promise<TicketTodoItemEntity[]>;
  /** Any item, deleted ones included. */
  getItemById(id: string): Promise<TicketTodoItemEntity | null>;
  /** Any item by its per-ticket ref, deleted ones included. */
  getItemByRef(ticketId: string, ref: number): Promise<TicketTodoItemEntity | null>;
  /** Highest ref ever given on this ticket, deleted items included; 0 when none. */
  maxRef(ticketId: string): Promise<number>;
  /**
   * Insert a new item and its history rows in one transaction (sqlite, pg;
   * Supabase writes them in sequence — PostgREST has no multi-statement
   * transaction). 'ref_conflict' when UNIQUE(ticket_id, ref) refused the item
   * (concurrent create): nothing is written then.
   */
  insertItem(item: TicketTodoItemEntity, events: readonly TicketTodoEvent[]): Promise<'ok' | 'ref_conflict'>;
  /** Update an existing item and append its history rows — same atomicity as insertItem. */
  saveItem(item: TicketTodoItemEntity, events: readonly TicketTodoEvent[]): Promise<void>;
  /** History, newest first: the whole ticket, or one item. */
  listEvents(ticketId: string, itemId?: string): Promise<TicketTodoEvent[]>;
}
