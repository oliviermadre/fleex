import type { TicketTodoEvent, TodoActorType, TodoAssignee, TodoEventAction, TodoItemState, TodoSource } from '@fleex/shared';
import { TicketTodoItemEntity } from '../../domain/entities/ticket-todo-item.entity.js';

/**
 * Row ↔ entity mapping shared by the three todo store adapters. Dates come back
 * as ISO strings (sqlite, supabase) or Date (pg); `changes` as JSON text
 * (sqlite) or an object (pg JSONB, supabase).
 */
export type TodoItemRow = Record<string, unknown>;
export type TodoEventRow = Record<string, unknown>;

const date = (v: unknown): Date => new Date(v as string | Date);
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : date(v));
const iso = (v: unknown): string => date(v).toISOString();

export function todoItemFromRow(r: TodoItemRow): TicketTodoItemEntity {
  return new TicketTodoItemEntity(
    r.id as string,
    r.ticket_id as string,
    Number(r.ref),
    r.text as string,
    (r.note as string | null) ?? null,
    r.state as TodoItemState,
    Number(r.position),
    r.created_by_type as TodoActorType,
    r.created_by_name as string,
    dateOrNull(r.state_changed_at),
    (r.state_changed_by_type as TodoActorType | null) ?? null,
    (r.state_changed_by_name as string | null) ?? null,
    (r.cancel_reason as string | null) ?? null,
    assigneeFromRow(r),
    (r.assigned_by_type as TodoActorType | null) ?? null,
    (r.assigned_by_name as string | null) ?? null,
    (r.takeover_reason as string | null) ?? null,
    date(r.created_at),
    date(r.updated_at),
    dateOrNull(r.deleted_at),
  );
}

function assigneeFromRow(r: TodoItemRow): TodoAssignee | null {
  const type = r.assignee_type as TodoActorType | null | undefined;
  return type ? { type, name: (r.assignee_name as string | null) ?? null } : null;
}

export function todoItemToRow(i: TicketTodoItemEntity) {
  return {
    id: i.id,
    ticket_id: i.ticketId,
    ref: i.ref,
    text: i.text,
    note: i.note,
    state: i.state,
    position: i.position,
    created_by_type: i.createdByType,
    created_by_name: i.createdByName,
    state_changed_at: i.stateChangedAt?.toISOString() ?? null,
    state_changed_by_type: i.stateChangedByType,
    state_changed_by_name: i.stateChangedByName,
    cancel_reason: i.cancelReason,
    assignee_type: i.assignee?.type ?? null,
    assignee_name: i.assignee?.name ?? null,
    assigned_by_type: i.assignedByType,
    assigned_by_name: i.assignedByName,
    takeover_reason: i.takeoverReason,
    created_at: i.createdAt.toISOString(),
    updated_at: i.updatedAt.toISOString(),
    deleted_at: i.deletedAt?.toISOString() ?? null,
  };
}

export function todoEventFromRow(r: TodoEventRow): TicketTodoEvent {
  const changes = typeof r.changes === 'string' ? JSON.parse(r.changes) : (r.changes ?? {});
  return {
    id: r.id as string,
    itemId: r.item_id as string,
    ticketId: r.ticket_id as string,
    itemRef: Number(r.item_ref),
    itemText: r.item_text as string,
    action: r.action as TodoEventAction,
    changes,
    actorType: r.actor_type as TodoActorType,
    actorName: r.actor_name as string,
    source: r.source as TodoSource,
    createdAt: iso(r.created_at),
  };
}

/** Row for an insert; `changes` left as an object (stringify it for sqlite). */
export function todoEventToRow(e: TicketTodoEvent) {
  return {
    id: e.id,
    item_id: e.itemId,
    ticket_id: e.ticketId,
    item_ref: e.itemRef,
    item_text: e.itemText,
    action: e.action,
    changes: e.changes,
    actor_type: e.actorType,
    actor_name: e.actorName,
    source: e.source,
    created_at: e.createdAt,
  };
}

/** Postgres unique_violation (pg and PostgREST both surface code 23505). */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === '23505' || e.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || (typeof e.message === 'string' && /UNIQUE constraint failed|duplicate key value/i.test(e.message));
}
