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

  async insertItem(item: TicketTodoItemEntity, events: readonly TicketTodoEvent[]): Promise<'ok' | 'ref_conflict'> {
    try {
      this.inTransaction(() => {
        this.conn.db.prepare(`
          INSERT INTO ticket_todo_items
            (id, ticket_id, ref, text, note, state, position, created_by_type, created_by_name,
             state_changed_at, state_changed_by_type, state_changed_by_name, cancel_reason,
             assignee_type, assignee_name, assigned_by_type, assigned_by_name, takeover_reason,
             created_at, updated_at, deleted_at)
          VALUES
            (@id, @ticket_id, @ref, @text, @note, @state, @position, @created_by_type, @created_by_name,
             @state_changed_at, @state_changed_by_type, @state_changed_by_name, @cancel_reason,
             @assignee_type, @assignee_name, @assigned_by_type, @assigned_by_name, @takeover_reason,
             @created_at, @updated_at, @deleted_at)
        `).run(todoItemToRow(item));
        this.insertEvents(events);
      });
      return 'ok';
    } catch (err) {
      if (isUniqueViolation(err)) return 'ref_conflict';
      throw err;
    }
  }

  async saveItem(item: TicketTodoItemEntity, events: readonly TicketTodoEvent[]): Promise<void> {
    this.inTransaction(() => {
      this.conn.db.prepare(`
        UPDATE ticket_todo_items SET
          text = @text, note = @note, state = @state, position = @position,
          state_changed_at = @state_changed_at, state_changed_by_type = @state_changed_by_type,
          state_changed_by_name = @state_changed_by_name, cancel_reason = @cancel_reason,
          assignee_type = @assignee_type, assignee_name = @assignee_name,
          assigned_by_type = @assigned_by_type, assigned_by_name = @assigned_by_name,
          takeover_reason = @takeover_reason,
          updated_at = @updated_at, deleted_at = @deleted_at
        WHERE id = @id
      `).run(todoItemToRow(item));
      this.insertEvents(events);
    });
  }

  private insertEvents(events: readonly TicketTodoEvent[]): void {
    const stmt = this.conn.db.prepare(`
      INSERT INTO ticket_todo_events
        (id, item_id, ticket_id, item_ref, item_text, action, changes, actor_type, actor_name, source, created_at)
      VALUES
        (@id, @item_id, @ticket_id, @item_ref, @item_text, @action, @changes, @actor_type, @actor_name, @source, @created_at)
    `);
    for (const event of events) {
      const row = todoEventToRow(event);
      stmt.run({ ...row, changes: JSON.stringify(row.changes) });
    }
  }

  /** Item + history together: a failed history row must not leave an unrecorded change. */
  private inTransaction(work: () => void): void {
    this.conn.db.exec('BEGIN');
    try {
      work();
      this.conn.db.exec('COMMIT');
    } catch (error) {
      this.conn.db.exec('ROLLBACK');
      throw error;
    }
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
