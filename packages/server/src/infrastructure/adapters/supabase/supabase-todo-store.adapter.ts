import type { TicketTodoEvent } from '@fleex/shared';
import type { TicketTodoItemEntity } from '../../../domain/entities/ticket-todo-item.entity.js';
import type { TodoStorePort } from '../../../application/ports/todo-store.port.js';
import { isUniqueViolation, todoEventFromRow, todoEventToRow, todoItemFromRow, todoItemToRow, type TodoEventRow, type TodoItemRow } from '../todo-rows.js';
import type { SupabaseConnection } from './connection.js';

const ITEMS = 'ticket_todo_items';
const EVENTS = 'ticket_todo_events';
/** PostgREST caps a page at 1000 rows by default: history is read page by page. */
const PAGE = 1000;

export class SupabaseTodoStore implements TodoStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async listItems(ticketId: string): Promise<TicketTodoItemEntity[]> {
    const { data, error } = await this.conn.client
      .from(ITEMS)
      .select('*')
      .eq('ticket_id', ticketId)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .order('ref', { ascending: true });
    if (error) throw new Error(`SupabaseTodoStore.listItems failed: ${error.message}`);
    return (data as TodoItemRow[]).map(todoItemFromRow);
  }

  async getItemById(id: string): Promise<TicketTodoItemEntity | null> {
    const { data, error } = await this.conn.client.from(ITEMS).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseTodoStore.getItemById failed: ${error.message}`);
    return data ? todoItemFromRow(data as TodoItemRow) : null;
  }

  async getItemByRef(ticketId: string, ref: number): Promise<TicketTodoItemEntity | null> {
    const { data, error } = await this.conn.client.from(ITEMS).select('*').eq('ticket_id', ticketId).eq('ref', ref).maybeSingle();
    if (error) throw new Error(`SupabaseTodoStore.getItemByRef failed: ${error.message}`);
    return data ? todoItemFromRow(data as TodoItemRow) : null;
  }

  async maxRef(ticketId: string): Promise<number> {
    const { data, error } = await this.conn.client
      .from(ITEMS)
      .select('ref')
      .eq('ticket_id', ticketId)
      .order('ref', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`SupabaseTodoStore.maxRef failed: ${error.message}`);
    return data ? Number((data as { ref: number }).ref) : 0;
  }

  async insertItem(item: TicketTodoItemEntity): Promise<'ok' | 'ref_conflict'> {
    const { error } = await this.conn.client.from(ITEMS).insert(todoItemToRow(item));
    if (!error) return 'ok';
    if (isUniqueViolation(error)) return 'ref_conflict';
    throw new Error(`SupabaseTodoStore.insertItem failed: ${error.message}`);
  }

  async saveItem(item: TicketTodoItemEntity): Promise<void> {
    const { id, ticket_id: _t, ref: _r, created_by_type: _ct, created_by_name: _cn, created_at: _ca, ...fields } = todoItemToRow(item);
    const { error } = await this.conn.client.from(ITEMS).update(fields).eq('id', id);
    if (error) throw new Error(`SupabaseTodoStore.saveItem failed: ${error.message}`);
  }

  async addEvent(event: TicketTodoEvent): Promise<void> {
    const { error } = await this.conn.client.from(EVENTS).insert(todoEventToRow(event));
    if (error) throw new Error(`SupabaseTodoStore.addEvent failed: ${error.message}`);
  }

  async listEvents(ticketId: string, itemId?: string): Promise<TicketTodoEvent[]> {
    const out: TicketTodoEvent[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = this.conn.client.from(EVENTS).select('*').eq('ticket_id', ticketId);
      if (itemId) query = query.eq('item_id', itemId);
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`SupabaseTodoStore.listEvents failed: ${error.message}`);
      const rows = data as TodoEventRow[];
      out.push(...rows.map(todoEventFromRow));
      if (rows.length < PAGE) return out;
    }
  }
}
