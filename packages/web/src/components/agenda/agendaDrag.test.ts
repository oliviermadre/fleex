import { describe, it, expect } from 'vitest';
import type { AgendaItem, CalendarEvent } from '@fleex/shared';
import {
  applyDelta, applyEndDelta, applyPlanToItem, canDrag, canResize, dayDiff, dayIndexFromX, dueDateFor, isPast, nextHalfHour,
  planDrop, pxToMinutes, selectionRange, shiftDayKey, slotDate, snapMinutes, wallDelta,
} from './agendaDrag';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (y: number, mo: number, d: number, h = 0, mi = 0) => local(y, mo, d, h, mi).toISOString();

const series = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'ev1', title: 'Standup', description: null, allDay: false,
  start: iso(2026, 11, 2, 9), end: iso(2026, 11, 2, 9, 30),
  color: null, ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null,
  createdAt: '', updatedAt: '', ...over,
});

const eventItem = (ev: CalendarEvent, start = ev.start, end = ev.end): AgendaItem => ({
  id: ev.recurrence ? `event:${ev.id}:${start}` : `event:${ev.id}`, type: 'event',
  shape: ev.allDay ? 'allDay' : 'block', start, end, title: ev.title, event: ev,
});

const NOW = local(2026, 11, 5, 11, 7);

describe('snapping and geometry', () => {
  it('snaps to 15 minutes inside the day', () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-30)).toBe(0);
    expect(snapMinutes(1500)).toBe(1440);
    expect(snapMinutes(1439, 15, 1425)).toBe(1425);
  });

  it('turns grid pixels into minutes (60 px per hour)', () => {
    expect(pxToMinutes(90)).toBe(90);
    expect(pxToMinutes(30, 120)).toBe(15);
  });

  it('finds the day column under x, clamped to the grid', () => {
    expect(dayIndexFromX(105, 100, 700, 7)).toBe(0);
    expect(dayIndexFromX(350, 100, 700, 7)).toBe(2);
    expect(dayIndexFromX(2000, 100, 700, 7)).toBe(6);
    expect(dayIndexFromX(0, 100, 700, 7)).toBe(0);
  });

  it('click = one hour from the slot hit; drag = the snapped span', () => {
    expect(selectionRange(607, 607, false)).toEqual({ startMin: 600, endMin: 660 });
    expect(selectionRange(1430, 1430, false)).toEqual({ startMin: 1425, endMin: 1440 });
    expect(selectionRange(620, 548, true)).toEqual({ startMin: 540, endMin: 630 });
    expect(selectionRange(600, 601, true)).toEqual({ startMin: 600, endMin: 615 });
  });

  it('opens the `c` shortcut at the next :00 or :30', () => {
    expect(nextHalfHour(local(2026, 11, 5, 11, 7))).toEqual(local(2026, 11, 5, 11, 30));
    expect(nextHalfHour(local(2026, 11, 5, 11, 45))).toEqual(local(2026, 11, 5, 12, 0));
    expect(nextHalfHour(local(2026, 11, 5, 23, 40))).toEqual(local(2026, 11, 6, 0, 0));
  });
});

describe('day keys and deltas', () => {
  it('shifts and diffs calendar days across months', () => {
    expect(shiftDayKey('2026-10-30', 3)).toBe('2026-11-02');
    expect(dayDiff('2026-10-30', '2026-11-02')).toBe(3);
    expect(dayDiff('2026-11-02', '2026-10-30')).toBe(-3);
  });

  it('builds a local slot', () => {
    expect(slotDate('2026-11-05', 615)).toEqual(local(2026, 11, 5, 10, 15));
  });

  it('measures a move in wall-clock days + minutes', () => {
    expect(wallDelta(local(2026, 11, 2, 9), local(2026, 11, 4, 14, 15))).toEqual({ days: 2, minutes: 315 });
    expect(wallDelta(local(2026, 11, 4, 14), local(2026, 11, 2, 9))).toEqual({ days: -2, minutes: -300 });
  });

  it('moves an all-day event keeping its inclusive last day', () => {
    expect(applyDelta({ allDay: true, start: '2026-11-02', end: '2026-11-04' }, { days: 3, minutes: 0 }))
      .toEqual({ start: '2026-11-05', end: '2026-11-07' });
  });

  it('moves a timed event and resizes only its end', () => {
    const ev = { allDay: false, start: iso(2026, 11, 2, 9), end: iso(2026, 11, 2, 10) };
    expect(applyDelta(ev, { days: 1, minutes: 30 })).toEqual({ start: iso(2026, 11, 3, 9, 30), end: iso(2026, 11, 3, 10, 30) });
    expect(applyEndDelta(ev, { days: 0, minutes: 45 })).toEqual({ start: ev.start, end: iso(2026, 11, 2, 10, 45) });
  });

  it('knows the past and sends due dates at noon UTC', () => {
    expect(isPast(local(2026, 11, 5, 11, 0), NOW)).toBe(true);
    expect(isPast(local(2026, 11, 5, 11, 15), NOW)).toBe(false);
    expect(dueDateFor('2026-11-12')).toBe('2026-11-12T12:00:00.000Z');
  });
});

describe('canDrag — only E1, T4 and once routines move', () => {
  it('follows the PO list', () => {
    const ev = eventItem(series());
    expect(canDrag(ev)).toBe(true);
    expect(canResize(ev)).toBe(true);
    expect(canDrag({ id: 't', type: 'ticket.due', shape: 'allDay', start: '2026-11-05', title: 'x', ticket: { id: 'tk', displayId: 1, title: 'x', boardId: 'b', status: 'todo', tags: [], epicIds: [], repos: [] } })).toBe(true);
    const up = (triggerKind: 'once' | 'cron'): AgendaItem => ({ id: 'u', type: 'routine.upcoming', shape: 'point', start: iso(2026, 11, 6, 9), title: 'r', routine: { id: 'r', name: 'r', emoji: '', triggerKind } });
    expect(canDrag(up('once'))).toBe(true);
    expect(canDrag(up('cron'))).toBe(false);
    for (const type of ['ticket.created', 'ticket.done', 'workflow.run', 'routine.run', 'external', 'pr.merged'] as const) {
      expect(canDrag({ id: type, type, shape: 'point', start: iso(2026, 11, 5, 9), title: type })).toBe(false);
    }
  });
});

describe('planDrop', () => {
  it('moves a timed event in the grid, keeping the grab offset and the duration', () => {
    const ev = series();
    // Grabbed 10 minutes below its top, dropped with the pointer at Wed 14:22.
    const plan = planDrop({ kind: 'move', item: eventItem(ev), grabMin: 10 }, { dayKey: '2026-11-04', minutes: 14 * 60 + 22 }, NOW);
    expect(plan?.kind).toBe('event');
    if (plan?.kind !== 'event') return;
    expect(plan.patch).toEqual({ start: iso(2026, 11, 4, 14, 15), end: iso(2026, 11, 4, 14, 45) });
    expect(plan.series).toBe(false);
    expect(plan.preview).toMatchObject({ dayKey: '2026-11-04', startMin: 855, endMin: 885 });
  });

  it('shifts the whole series by the occurrence delta', () => {
    const ev = series({ recurrence: 'daily' });
    const occ = eventItem(ev, iso(2026, 11, 5, 9), iso(2026, 11, 5, 9, 30));
    const plan = planDrop({ kind: 'move', item: occ, grabMin: 0 }, { dayKey: '2026-11-05', minutes: 11 * 60 }, NOW);
    if (plan?.kind !== 'event') throw new Error('expected an event plan');
    expect(plan.series).toBe(true);
    expect(plan.patch).toEqual({ start: iso(2026, 11, 2, 11), end: iso(2026, 11, 2, 11, 30) });
    expect(applyPlanToItem(plan, occ)).toMatchObject({ start: iso(2026, 11, 5, 11), end: iso(2026, 11, 5, 11, 30) });
  });

  it('resizes from the bottom edge, never shorter than 15 minutes', () => {
    const ev = series();
    const item = eventItem(ev);
    const longer = planDrop({ kind: 'resize', item }, { dayKey: '2026-11-02', minutes: 10 * 60 + 50 }, NOW);
    if (longer?.kind !== 'event') throw new Error('expected an event plan');
    expect(longer.edge).toBe('end');
    expect(longer.patch).toEqual({ start: ev.start, end: iso(2026, 11, 2, 10, 45) });
    const tiny = planDrop({ kind: 'resize', item }, { dayKey: '2026-11-02', minutes: 8 * 60 }, NOW);
    if (tiny?.kind !== 'event') throw new Error('expected an event plan');
    expect(tiny.patch.end).toBe(iso(2026, 11, 2, 9, 15));
  });

  it('moves a timed event to a month cell: same time, other day', () => {
    const plan = planDrop({ kind: 'move', item: eventItem(series()), grabMin: 0 }, { dayKey: '2026-11-09', minutes: null }, NOW);
    if (plan?.kind !== 'event') throw new Error('expected an event plan');
    expect(plan.patch).toEqual({ start: iso(2026, 11, 9, 9), end: iso(2026, 11, 9, 9, 30) });
    expect(plan.preview.startMin).toBeNull();
  });

  it('moves an all-day event by whole days, inclusive end kept', () => {
    const ev = series({ allDay: true, start: '2026-11-02', end: '2026-11-03' });
    const plan = planDrop({ kind: 'move', item: eventItem(ev), grabMin: 0 }, { dayKey: '2026-11-06', minutes: 600 }, NOW);
    if (plan?.kind !== 'event') throw new Error('expected an event plan');
    expect(plan.patch).toEqual({ start: '2026-11-06', end: '2026-11-07' });
  });

  it('is a no-op when dropped where it was', () => {
    expect(planDrop({ kind: 'move', item: eventItem(series()), grabMin: 0 }, { dayKey: '2026-11-02', minutes: 9 * 60 + 4 }, NOW)).toBeNull();
  });

  it('moves a due date to another day', () => {
    const item: AgendaItem = { id: 'ticket.due:tk', type: 'ticket.due', shape: 'allDay', start: '2026-11-05', title: 'Ship', ticket: { id: 'tk', displayId: 3, title: 'Ship', boardId: 'b', status: 'todo', tags: [], epicIds: [], repos: [] } };
    expect(planDrop({ kind: 'move', item, grabMin: 0 }, { dayKey: '2026-11-07', minutes: null }, NOW)).toMatchObject({ kind: 'due', ticketId: 'tk', dayKey: '2026-11-07' });
    expect(planDrop({ kind: 'move', item, grabMin: 0 }, { dayKey: '2026-11-05', minutes: null }, NOW)).toBeNull();
  });

  it('schedules a drawer ticket on the day it lands on', () => {
    expect(planDrop({ kind: 'ticket', ticketId: 'tk9', title: 'Later' }, { dayKey: '2026-11-10', minutes: 500 }, NOW))
      .toMatchObject({ kind: 'due', ticketId: 'tk9', dayKey: '2026-11-10', item: null });
  });

  it('reschedules a once routine, but never into the past', () => {
    const item: AgendaItem = { id: 'routine.upcoming:r:x', type: 'routine.upcoming', shape: 'point', start: iso(2026, 11, 6, 9), title: 'Digest', routine: { id: 'r', name: 'Digest', emoji: '', triggerKind: 'once' } };
    expect(planDrop({ kind: 'move', item, grabMin: 0 }, { dayKey: '2026-11-06', minutes: 16 * 60 + 2 }, NOW))
      .toMatchObject({ kind: 'routine', routineId: 'r', runAt: iso(2026, 11, 6, 16) });
    expect(planDrop({ kind: 'move', item, grabMin: 0 }, { dayKey: '2026-11-04', minutes: 600 }, NOW)?.kind).toBe('refused');
    expect(planDrop({ kind: 'move', item, grabMin: 0 }, { dayKey: '2026-11-08', minutes: null }, NOW))
      .toMatchObject({ kind: 'routine', runAt: iso(2026, 11, 8, 9) });
  });
});

describe('planDrop — multi-day all-day chips', () => {
  it('moves by the distance from the day the chip was grabbed on', () => {
    const ev = series({ allDay: true, start: '2026-11-02', end: '2026-11-04' });
    // Grabbed on its 3rd day (Nov 4), dropped on Nov 6: +2 days.
    const plan = planDrop({ kind: 'move', item: eventItem(ev), grabMin: 2 * 1440 }, { dayKey: '2026-11-06', minutes: null }, NOW);
    if (plan?.kind !== 'event') throw new Error('expected an event plan');
    expect(plan.patch).toEqual({ start: '2026-11-04', end: '2026-11-06' });
  });
});
