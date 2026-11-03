/**
 * The ticket's todo history as Timeline marks (SPEC todo-timeline §3.4) — pure.
 *
 * Only four moments are worth a mark on the frieze: an item was created, done,
 * cancelled, or reopened (from done / cancelled back to open — the QA loop).
 * Edits, moves, assignments, deletes and restores stay in the panel's History.
 *
 * An immediate Undo must not litter the frieze: a state change reverted by the
 * same actor within FOLD_MS, with no other mark on that item in between, drops
 * both marks (the History keeps both rows).
 *
 * Marks of a deleted item stay — it is history — flagged `deleted` so the
 * reader can strike them and not offer to open a row that no longer exists.
 */
import type { TicketTodoEvent, TodoActorType, TodoItemState, TodoSource } from '@fleex/shared';
import type { TintHue } from '../../../lib/tints';

export type TodoMarkKind = 'created' | 'done' | 'cancelled' | 'reopened';

/** Display order of a chip's segments, whatever the order of the events. */
export const TODO_MARK_KINDS: readonly TodoMarkKind[] = ['created', 'done', 'cancelled', 'reopened'];

export const TODO_MARK_HUE: Record<TodoMarkKind, TintHue> = {
  created: 'blue',
  done: 'green',
  cancelled: 'gray',
  reopened: 'orange',
};

export const TODO_MARK_LABEL: Record<TodoMarkKind, { one: string; many: string }> = {
  created: { one: 'créé', many: 'créés' },
  done: { one: 'fait', many: 'faits' },
  cancelled: { one: 'annulé', many: 'annulés' },
  reopened: { one: 'rouvert', many: 'rouverts' },
};

/** An Undo reverted within this delay (same actor) leaves no mark. */
export const FOLD_MS = 60_000;

export interface TodoMark {
  /** The history row's id. */
  id: string;
  itemId: string;
  ref: number;
  kind: TodoMarkKind;
  /** ms epoch. */
  at: number;
  /** The item's text when it happened. */
  itemText: string;
  actorType: TodoActorType;
  actorName: string;
  source: TodoSource;
  /** A cancel's reason. */
  reason: string | null;
  /** The item is deleted now (not restored since). */
  deleted: boolean;
}

interface StateMark extends TodoMark {
  from: TodoItemState;
  to: TodoItemState;
  folded: boolean;
}

function kindOf(e: TicketTodoEvent): TodoMarkKind | null {
  if (e.action === 'created') return 'created';
  if (e.action !== 'state_changed') return null;
  const s = e.changes.state;
  if (!s) return null;
  if (s.to === 'done') return 'done';
  if (s.to === 'cancelled') return 'cancelled';
  if (s.to === 'open' && (s.from === 'done' || s.from === 'cancelled')) return 'reopened';
  return null;
}

/** The marks of a ticket's todo history (any order in), chronological out. */
export function todoMarks(events: readonly TicketTodoEvent[]): TodoMark[] {
  // Same timestamp (a `--file` seeds 8 items in one second): refs in order across
  // items; within one item, the API's order (newest first) reversed.
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) =>
      Date.parse(a.e.createdAt) - Date.parse(b.e.createdAt) ||
      (a.e.itemId !== b.e.itemId ? a.e.itemRef - b.e.itemRef : b.i - a.i))
    .map(({ e }) => e);

  const deleted = new Map<string, boolean>();
  for (const e of sorted) {
    if (e.action === 'deleted') deleted.set(e.itemId, true);
    else if (e.action === 'edited' && e.changes.deleted) deleted.set(e.itemId, false);
  }

  const marks: StateMark[] = [];
  /** Per item, its latest kept mark — what an Undo may fold with. */
  const last = new Map<string, StateMark | null>();
  for (const e of sorted) {
    const kind = kindOf(e);
    if (!kind) continue;
    const state = e.changes.state;
    const reason = typeof e.changes.reason?.to === 'string' ? e.changes.reason.to : null;
    const m: StateMark = {
      id: e.id,
      itemId: e.itemId,
      ref: e.itemRef,
      kind,
      at: Date.parse(e.createdAt),
      itemText: e.itemText,
      actorType: e.actorType,
      actorName: e.actorName,
      source: e.source,
      reason,
      deleted: deleted.get(e.itemId) ?? false,
      from: (state?.from ?? 'open') as TodoItemState,
      to: (state?.to ?? 'open') as TodoItemState,
      folded: false,
    };
    const prev = last.get(e.itemId);
    const isUndo =
      !!state && !!prev && prev.kind !== 'created' &&
      prev.from === m.to && prev.to === m.from &&
      prev.actorType === m.actorType && prev.actorName === m.actorName &&
      m.at - prev.at < FOLD_MS;
    if (isUndo) {
      prev!.folded = true;
      last.set(e.itemId, null);
      continue;
    }
    marks.push(m);
    last.set(e.itemId, m);
  }

  return marks.filter((m) => !m.folded).map(({ from: _f, to: _t, folded: _x, ...mark }) => mark);
}
