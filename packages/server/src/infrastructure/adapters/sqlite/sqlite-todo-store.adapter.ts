import type { TicketTodoEvent } from '@fleex/shared';
import type { TicketTodoItemEntity } from '../../../domain/entities/ticket-todo-item.entity.js';
import type { TodoStorePort } from '../../../application/ports/todo-store.port.js';
import { isUniqueViolation, todoEventFromRow, todoEventToRow, todoItemFromRow, todoItemToRow, type TodoEventRow, type TodoItemRow } from '../todo-rows.js';
import type { SqliteConnection } from './connection.js';

export class SqliteTodoStoreAdapter implements TodoStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async listItems(ticketId: string): Promise<TicketTodoItemEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM ticket_todo_items WHERE ticket_id = ? AND deleted_at IS NULL ORDER BY position ASC, ref ASC')
      .all(ticketId) as TodoItemRow[];
    return rows.map(todoItemFromRow);
  }

  async getItemById(id: string): Promise<TicketTodoItemEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM ticket_todo_items WHERE id = ?').get(id) as TodoItemRow | undefined;
    return row ? todoItemFromRow(row) : null;
  }

  async getItemByRef(ticketId: string, ref: number): Promise<TicketTodoItemEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM ticket_todo_items WHERE ticket_id = ? AND ref = ?')
      .get(ticketId, ref) as TodoItemRow | undefined;
    return row ? todoItemFromRow(row) : null;
  }

  async maxRef(ticketId: string): Promise<number> {
    const row = this.conn.db
      .prepare('SELECT COALESCE(MAX(ref), 0) AS m FROM ticket_todo_items WHERE ticket_id = ?')
      .get(ticketId) as { m: number };
    return Number(row.m);
  }

  async insertItem(item: TicketTodoItemEntity): Promise<'ok' | 'ref_conflict'> {
    try {
      this.conn.db.prepare(`
        INSERT INTO ticket_todo_items
          (id, ticket_id, ref, text, note, state, position, created_by_type, created_by_name,
           state_changed_at, state_changed_by_type, state_changed_by_name, cancel_reason, created_at, updated_at, deleted_at)
        VALUES
          (@id, @ticket_id, @ref, @text, @note, @state, @position, @created_by_type, @created_by_name,
           @state_changed_at, @state_changed_by_type, @state_changed_by_name, @cancel_reason, @created_at, @updated_at, @deleted_at)
      `).run(todoItemToRow(item));
      return 'ok';
    } catch (err) {
      if (isUniqueViolation(err)) return 'ref_conflict';
      throw err;
    }
  }

  async saveItem(item: TicketTodoItemEntity): Promise<void> {
    this.conn.db.prepare(`
      UPDATE ticket_todo_items SET
        text = @text, note = @note, state = @state, position = @position,
        state_changed_at = @state_changed_at, state_changed_by_type = @state_changed_by_type,
        state_changed_by_name = @state_changed_by_name, cancel_reason = @cancel_reason,
        updated_at = @updated_at, deleted_at = @deleted_at
      WHERE id = @id
    `).run(todoItemToRow(item));
  }

  async addEvent(event: TicketTodoEvent): Promise<void> {
    const row = todoEventToRow(event);
    this.conn.db.prepare(`
      INSERT INTO ticket_todo_events
        (id, item_id, ticket_id, item_ref, item_text, action, changes, actor_type, actor_name, source, created_at)
      VALUES
        (@id, @item_id, @ticket_id, @item_ref, @item_text, @action, @changes, @actor_type, @actor_name, @source, @created_at)
    `).run({ ...row, changes: JSON.stringify(row.changes) });
  }

  async listEvents(ticketId: string, itemId?: string): Promise<TicketTodoEvent[]> {
    const rows = itemId
      ? this.conn.db
        .prepare('SELECT * FROM ticket_todo_events WHERE ticket_id = ? AND item_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(ticketId, itemId)
      : this.conn.db
        .prepare('SELECT * FROM ticket_todo_events WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(ticketId);
    return (rows as TodoEventRow[]).map(todoEventFromRow);
  }
}
