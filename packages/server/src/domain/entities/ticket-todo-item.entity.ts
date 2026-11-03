import type { TicketTodoItem, TodoActorType, TodoItemState } from '@fleex/shared';
import { TODO_NOTE_MAX, TODO_REASON_MAX, isTodoItemState, sanitizeForStorage, validateTodoText } from '@fleex/shared';
import { InvalidTodoError } from '../errors.js';

export interface TodoActorRef {
  type: TodoActorType;
  name: string;
}

/** A field change as recorded in the history: `{ from, to }`. */
export type TodoChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * One item of a ticket's shared todo list.
 *
 * Invariants: text is one trimmed line of 1..500 chars, note ≤ 4000 chars (or
 * null), state is open | done | cancelled. Every transition between two
 * different states is allowed; a transition to the current state is a no-op
 * (returns null) so callers write no history for it.
 */
export class TicketTodoItemEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly ref: number,
    public text: string,
    public note: string | null,
    public state: TodoItemState,
    public position: number,
    public readonly createdByType: TodoActorType,
    public readonly createdByName: string,
    public stateChangedAt: Date | null,
    public stateChangedByType: TodoActorType | null,
    public stateChangedByName: string | null,
    public cancelReason: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public deletedAt: Date | null,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    ref: number;
    text: string;
    note?: string | null;
    position: number;
    actor: TodoActorRef;
    now?: Date;
  }): TicketTodoItemEntity {
    const now = params.now ?? new Date();
    return new TicketTodoItemEntity(
      params.id, params.ticketId, params.ref,
      validText(params.text), validNote(params.note ?? null), 'open', params.position,
      params.actor.type, params.actor.name,
      null, null, null, null,
      now, now, null,
    );
  }

  /** Edit text and/or note. Returns the diff, or null when nothing changed. */
  edit(patch: { text?: string; note?: string | null }, now = new Date()): TodoChanges | null {
    // Validate everything before mutating anything.
    const text = patch.text !== undefined ? validText(patch.text) : this.text;
    const note = patch.note !== undefined ? validNote(patch.note) : this.note;
    const changes: TodoChanges = {};
    if (text !== this.text) changes.text = { from: this.text, to: text };
    if (note !== this.note) changes.note = { from: this.note, to: note };
    if (Object.keys(changes).length === 0) return null;
    this.text = text;
    this.note = note;
    this.updatedAt = now;
    return changes;
  }

  /** Move to another state. Returns the diff, or null when already in that state. */
  transition(to: string, actor: TodoActorRef, reason?: string | null, now = new Date()): TodoChanges | null {
    if (!isTodoItemState(to)) throw new InvalidTodoError(`Invalid todo state: ${to} (valid: open, done, cancelled)`);
    if (to === this.state) return null;
    const cleanReason = to === 'cancelled' ? validReason(reason ?? null) : null;
    const changes: TodoChanges = { state: { from: this.state, to } };
    if (cleanReason) changes.reason = { from: null, to: cleanReason };
    this.state = to;
    this.cancelReason = cleanReason;
    this.stateChangedAt = now;
    this.stateChangedByType = actor.type;
    this.stateChangedByName = actor.name;
    this.updatedAt = now;
    return changes;
  }

  /** Reorder. Returns the diff, or null when the position is unchanged. */
  moveTo(position: number, now = new Date()): TodoChanges | null {
    if (!Number.isFinite(position)) throw new InvalidTodoError(`Invalid todo position: ${position}`);
    if (position === this.position) return null;
    const changes: TodoChanges = { position: { from: this.position, to: position } };
    this.position = position;
    this.updatedAt = now;
    return changes;
  }

  markDeleted(now = new Date()): void {
    this.deletedAt = now;
    this.updatedAt = now;
  }

  toDTO(): TicketTodoItem {
    return {
      id: this.id,
      ticketId: this.ticketId,
      ref: this.ref,
      text: this.text,
      note: this.note,
      state: this.state,
      position: this.position,
      createdByType: this.createdByType,
      createdByName: this.createdByName,
      stateChangedAt: this.stateChangedAt?.toISOString() ?? null,
      stateChangedByType: this.stateChangedByType,
      stateChangedByName: this.stateChangedByName,
      cancelReason: this.cancelReason,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}

function validText(raw: string): string {
  const result = validateTodoText(sanitizeForStorage(String(raw ?? '')));
  if (!result.ok) throw new InvalidTodoError(result.error);
  return result.text;
}

function validNote(raw: string | null): string | null {
  if (raw === null) return null;
  const note = sanitizeForStorage(String(raw)).trim();
  if (note.length === 0) return null;
  if (note.length > TODO_NOTE_MAX) throw new InvalidTodoError(`Todo note must be at most ${TODO_NOTE_MAX} characters`);
  return note;
}

function validReason(raw: string | null): string | null {
  if (raw === null) return null;
  const reason = sanitizeForStorage(String(raw)).trim();
  if (reason.length === 0) return null;
  if (reason.length > TODO_REASON_MAX) throw new InvalidTodoError(`Cancel reason must be at most ${TODO_REASON_MAX} characters`);
  return reason;
}
