/**
 * What of the todo history reaches the frieze. nas wants to see when items are
 * created and closed — and reopened, or the QA loop reads as "#3 done twice" —
 * without the noise of edits, moves, or a checkbox clicked then undone.
 */
import { describe, it, expect } from 'vitest';
import type { TicketTodoEvent } from '@fleex/shared';
import { FOLD_MS, todoMarks } from './todoMarks';

const T0 = Date.parse('2026-11-03T10:00:00.000Z');
let n = 0;
const ev = (over: Partial<TicketTodoEvent> & { at: number }): TicketTodoEvent => {
  const { at, ...rest } = over;
  return {
    id: `e${++n}`, itemId: 'i1', ticketId: 't1', itemRef: 1, itemText: 'Item 1', action: 'created', changes: {},
    actorType: 'user', actorName: 'nas', source: 'web', createdAt: new Date(at).toISOString(), ...rest,
  };
};
const state = (from: string, to: string, at: number, over: Partial<TicketTodoEvent> = {}) =>
  ev({ action: 'state_changed', changes: { state: { from, to } }, at, ...over });

describe('todoMarks — what becomes a mark', () => {
  it('maps created, done, cancelled and reopened, and nothing else', () => {
    const marks = todoMarks([
      ev({ at: T0 }),
      state('open', 'done', T0 + 120_000),
      state('done', 'open', T0 + 240_000, { actorName: 'Builder', actorType: 'agent' }),
      state('open', 'cancelled', T0 + 360_000, { changes: { state: { from: 'open', to: 'cancelled' }, reason: { from: null, to: 'couvert par #3' } } }),
      state('cancelled', 'done', T0 + 480_000),
      ev({ action: 'edited', changes: { text: { from: 'a', to: 'b' } }, at: T0 + 500_000 }),
      ev({ action: 'moved', changes: { position: { from: 1, to: 2 } }, at: T0 + 510_000 }),
      ev({ action: 'assigned', changes: { assignee: { from: null, to: { type: 'user', name: 'nas' } } }, at: T0 + 520_000 }),
    ]);
    expect(marks.map((m) => m.kind)).toEqual(['created', 'done', 'reopened', 'cancelled', 'done']);
    expect(marks[3]!.reason).toBe('couvert par #3');
  });

  it('accepts the API order (newest first) and returns them chronologically', () => {
    const marks = todoMarks([state('open', 'done', T0 + 120_000), ev({ at: T0 })]);
    expect(marks.map((m) => m.kind)).toEqual(['created', 'done']);
  });
});

describe('todoMarks — same-second bursts', () => {
  it('orders items created in the same second by ref, and one item\'s changes by the API order (newest first)', () => {
    const marks = todoMarks([
      state('open', 'done', T0, { itemId: 'i3', itemRef: 3 }),
      ev({ at: T0, itemId: 'i3', itemRef: 3 }),
      ev({ at: T0, itemId: 'i4', itemRef: 4 }),
      ev({ at: T0 }),
    ]);
    expect(marks.map((m) => `${m.kind}#${m.ref}`)).toEqual(['created#1', 'created#3', 'done#3', 'created#4']);
  });
});

describe('todoMarks — an immediate Undo leaves no mark', () => {
  it('folds a state change reverted by the same actor within 60 s', () => {
    const marks = todoMarks([ev({ at: T0 }), state('open', 'done', T0 + 600_000), state('done', 'open', T0 + 603_000)]);
    expect(marks.map((m) => m.kind)).toEqual(['created']);
  });

  it('keeps both marks past 60 s', () => {
    const marks = todoMarks([state('open', 'done', T0), state('done', 'open', T0 + FOLD_MS + 1000)]);
    expect(marks.map((m) => m.kind)).toEqual(['done', 'reopened']);
  });

  it('keeps both marks when another actor reverts it (that is a real reopen)', () => {
    const marks = todoMarks([state('open', 'done', T0), state('done', 'open', T0 + 5000, { actorType: 'agent', actorName: 'Builder' })]);
    expect(marks.map((m) => m.kind)).toEqual(['done', 'reopened']);
  });

  it('keeps them when another mark sits in between', () => {
    const marks = todoMarks([state('open', 'done', T0), state('done', 'cancelled', T0 + 2000), state('cancelled', 'open', T0 + 4000)]);
    expect(marks.map((m) => m.kind)).toEqual(['done', 'cancelled', 'reopened']);
  });

  it('only folds the same item', () => {
    const marks = todoMarks([state('open', 'done', T0), state('done', 'open', T0 + 2000, { itemId: 'i2', itemRef: 2 })]);
    expect(marks).toHaveLength(2);
  });
});

describe('todoMarks — deleted items', () => {
  it('keeps the marks of a deleted item, flagged deleted', () => {
    const marks = todoMarks([ev({ at: T0 }), ev({ action: 'deleted', at: T0 + 1000 })]);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.deleted).toBe(true);
  });

  it('a restore clears the flag', () => {
    const marks = todoMarks([
      ev({ at: T0 }),
      ev({ action: 'deleted', at: T0 + 1000 }),
      ev({ action: 'edited', changes: { deleted: { from: true, to: false } }, at: T0 + 2000 }),
    ]);
    expect(marks[0]!.deleted).toBe(false);
  });
});
