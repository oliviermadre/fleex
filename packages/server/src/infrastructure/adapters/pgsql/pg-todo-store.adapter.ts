import type { TicketTodoEvent } from '@fleex/shared';
import type { TicketTodoItemEntity } from '../../../domain/entities/ticket-todo-item.entity.js';
import type { TodoStorePort } from '../../../application/ports/todo-store.port.js';
import { isUniqueViolation, todoEventFromRow, todoEventToRow, todoItemFromRow, todoItemToRow } from '../todo-rows.js';
import type { PgConnection } from './connection.js';

const ITEM_COLUMNS = [
  'id', 'ticket_id', 'ref', 'text', 'note', 'state', 'position', 'created_by_type', 'created_by_name',
  'state_changed_at', 'state_changed_by_type', 'state_changed_by_name', 'cancel_reason', 'created_at', 'updated_at', 'deleted_at',
] as const;

export class PgTodoStore implements TodoStorePort {
  constructor(private readonly db: PgConnection) {}

  async listItems(ticketId: string): Promise<TicketTodoItemEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM ticket_todo_items WHERE ticket_id = $1 AND deleted_at IS NULL ORDER BY position ASC, ref ASC',
      [ticketId],
    );
    return rows.map(todoItemFromRow);
  }

  async getItemById(id: string): Promise<TicketTodoItemEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM ticket_todo_items WHERE id = $1', [id]);
    return rows.length > 0 ? todoItemFromRow(rows[0]) : null;
  }

  async getItemByRef(ticketId: string, ref: number): Promise<TicketTodoItemEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM ticket_todo_items WHERE ticket_id = $1 AND ref = $2', [ticketId, ref]);
    return rows.length > 0 ? todoItemFromRow(rows[0]) : null;
  }

  async maxRef(ticketId: string): Promise<number> {
    const { rows } = await this.db.query('SELECT COALESCE(MAX(ref), 0) AS m FROM ticket_todo_items WHERE ticket_id = $1', [ticketId]);
    return Number(rows[0]?.m ?? 0);
  }

  async insertItem(item: TicketTodoItemEntity): Promise<'ok' | 'ref_conflict'> {
    const row = todoItemToRow(item);
    try {
      await this.db.query(
        `INSERT INTO ticket_todo_items (${ITEM_COLUMNS.join(', ')})
         VALUES (${ITEM_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`,
        ITEM_COLUMNS.map((c) => row[c]),
      );
      return 'ok';
    } catch (err) {
      if (isUniqueViolation(err)) return 'ref_conflict';
      throw err;
    }
  }

  async saveItem(item: TicketTodoItemEntity): Promise<void> {
    const r = todoItemToRow(item);
    await this.db.query(
      `UPDATE ticket_todo_items SET
         text = $2, note = $3, state = $4, position = $5,
         state_changed_at = $6, state_changed_by_type = $7, state_changed_by_name = $8, cancel_reason = $9,
         updated_at = $10, deleted_at = $11
       WHERE id = $1`,
      [r.id, r.text, r.note, r.state, r.position, r.state_changed_at, r.state_changed_by_type,
        r.state_changed_by_name, r.cancel_reason, r.updated_at, r.deleted_at],
    );
  }

  async addEvent(event: TicketTodoEvent): Promise<void> {
    const r = todoEventToRow(event);
    await this.db.query(
      `INSERT INTO ticket_todo_events
         (id, item_id, ticket_id, item_ref, item_text, action, changes, actor_type, actor_name, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
      [r.id, r.item_id, r.ticket_id, r.item_ref, r.item_text, r.action, JSON.stringify(r.changes),
        r.actor_type, r.actor_name, r.source, r.created_at],
    );
  }

  async listEvents(ticketId: string, itemId?: string): Promise<TicketTodoEvent[]> {
    const { rows } = itemId
      ? await this.db.query(
        'SELECT * FROM ticket_todo_events WHERE ticket_id = $1 AND item_id = $2 ORDER BY created_at DESC, id DESC',
        [ticketId, itemId],
      )
      : await this.db.query('SELECT * FROM ticket_todo_events WHERE ticket_id = $1 ORDER BY created_at DESC, id DESC', [ticketId]);
    return rows.map(todoEventFromRow);
  }
}
