/**
 * Pure drag & drop math for /agenda (no DOM, no React): pixel → snapped
 * minutes, day index from x, wall-clock deltas applied to an event (all-day
 * inclusive end included), and what a drop means for each draggable item.
 *
 * Product rule (PO): only free events (E1), due dates (T4) and the upcoming
 * slot of a one-off ("once") routine move. Everything else is frozen.
 */
import type { AgendaItem, CalendarEvent } from '@fleex/shared';
import { DAY_MS, HOUR_PX, POINT_MIN, addDays, dayKey, parseDayKey } from './agendaLayout';

export const SNAP_MIN = 15;
/** A pointer must travel this far before a press becomes a drag (a shorter move is a click). */
export const DRAG_THRESHOLD_PX = 4;
/** A plain click on the grid creates a one-hour event. */
export const DEFAULT_EVENT_MIN = 60;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Nearest multiple of `step`, inside [0, max]. */
export function snapMinutes(min: number, step = SNAP_MIN, max = 1440): number {
  return clamp(Math.round(min / step) * step, 0, max);
}

/** Vertical pixels inside a day column → minutes since midnight (unsnapped). */
export function pxToMinutes(px: number, hourPx = HOUR_PX): number {
  return (px / hourPx) * 60;
}

/** Which of `count` equal columns spanning [left, left + width] holds `x` (clamped). */
export function dayIndexFromX(x: number, left: number, width: number, count: number): number {
  if (count <= 0 || width <= 0) return 0;
  return clamp(Math.floor((x - left) / (width / count)), 0, count - 1);
}

/** Local wall-clock minutes since midnight, whole minutes only. */
export const wallMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Local instant `minutes` after midnight of the day `key` (minutes may exceed 1440). */
export function slotDate(key: string, minutes: number): Date {
  const d = parseDayKey(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes);
}

export function shiftDayKey(key: string, days: number): string {
  return dayKey(addDays(parseDayKey(key), days));
}

/** Calendar days from `a` to `b` ('YYYY-MM-DD'), DST-proof. */
export function dayDiff(a: string, b: string): number {
  return Math.round((parseDayKey(b).getTime() - parseDayKey(a).getTime()) / DAY_MS);
}

/**
 * A move expressed in wall-clock terms: "+2 days, −30 minutes". Applied to a
 * recurring series it keeps the local time across DST, unlike a raw ms delta.
 */
export interface WallDelta { days: number; minutes: number }

export function wallDelta(from: Date, to: Date): WallDelta {
  return { days: dayDiff(dayKey(from), dayKey(to)), minutes: wallMinutes(to) - wallMinutes(from) };
}

export function shiftInstant(iso: string, d: WallDelta): string {
  const x = addDays(new Date(iso), d.days);
  x.setMinutes(x.getMinutes() + d.minutes);
  return x.toISOString();
}

export type EventTimes = Pick<CalendarEvent, 'allDay' | 'start' | 'end'>;

/**
 * Move a whole event (or series) by a wall-clock delta. All-day events move
 * by days only and keep their inclusive last day aligned.
 */
export function applyDelta(ev: EventTimes, d: WallDelta): { start: string; end: string } {
  if (ev.allDay) return { start: shiftDayKey(ev.start, d.days), end: shiftDayKey(ev.end, d.days) };
  return { start: shiftInstant(ev.start, d), end: shiftInstant(ev.end, d) };
}

/** Resize: only the end moves. */
export function applyEndDelta(ev: EventTimes, d: WallDelta): { start: string; end: string } {
  return { start: ev.start, end: shiftInstant(ev.end, d) };
}

export const isPast = (d: Date, now: Date) => d.getTime() < now.getTime();

/**
 * The `dueDate` sent for a calendar day: noon UTC. The server keys due dates
 * by their UTC date, and noon UTC is the same calendar day in every zone
 * from UTC−11 to UTC+11.
 */
export const dueDateFor = (key: string) => `${key}T12:00:00.000Z`;

/** The next :00 or :30 strictly after `now` (the `c` shortcut). */
export function nextHalfHour(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

/**
 * Click or click-drag on an empty grid slot → the range to create. A click
 * gives one hour from the 15-min slot it hit; a drag covers the snapped span
 * (15 min at least).
 */
export function selectionRange(anchorMin: number, currentMin: number, moved: boolean): { startMin: number; endMin: number } {
  if (!moved) {
    const s = clamp(Math.floor(anchorMin / SNAP_MIN) * SNAP_MIN, 0, 1440 - SNAP_MIN);
    return { startMin: s, endMin: Math.min(1440, s + DEFAULT_EVENT_MIN) };
  }
  const lo = Math.min(anchorMin, currentMin);
  const hi = Math.max(anchorMin, currentMin);
  const s = clamp(Math.floor(lo / SNAP_MIN) * SNAP_MIN, 0, 1440 - SNAP_MIN);
  const e = clamp(Math.ceil(hi / SNAP_MIN) * SNAP_MIN, s + SNAP_MIN, 1440);
  return { startMin: s, endMin: e };
}

/** The PO's list: free events, due dates and the next slot of a one-off routine. */
export function canDrag(item: AgendaItem): boolean {
  if (item.type === 'event') return !!item.event;
  if (item.type === 'ticket.due') return !!item.ticket;
  if (item.type === 'routine.upcoming') return item.routine?.triggerKind === 'once';
  return false;
}

/** Free events with a duration can also be resized from their bottom edge. */
export const canResize = (item: AgendaItem) => item.type === 'event' && item.shape === 'block' && !!item.event && !!item.end;

// ── Drop planning ──

export type DragSource =
  | {
    kind: 'move';
    item: AgendaItem;
    /** Minutes between the item's start and the grabbed point (whole days × 1440 for an all-day chip). */
    grabMin: number;
  }
  | { kind: 'resize'; item: AgendaItem }
  | { kind: 'ticket'; ticketId: string; title: string };

/** A day column of the grid (minutes known) or a day cell (all-day band, month: minutes null). */
export interface DropTarget { dayKey: string; minutes: number | null }

/** What to draw under the pointer: a day cell highlight, or a slot in a grid column. */
export interface DropPreview { dayKey: string; startMin: number | null; endMin: number | null; label: string }

export type DropPlan =
  | { kind: 'event'; item: AgendaItem; eventId: string; edge: 'both' | 'end'; delta: WallDelta; patch: { start: string; end: string }; series: boolean; preview: DropPreview }
  | { kind: 'due'; ticketId: string; title: string; item: AgendaItem | null; dayKey: string; preview: DropPreview }
  | { kind: 'routine'; item: AgendaItem; routineId: string; runAt: string; preview: DropPreview }
  | { kind: 'refused'; reason: string; preview: DropPreview };

const fmtDay = (key: string) => parseDayKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Where the timed item now starts on the grid, from the pointer's minutes and the grab offset. */
function droppedStart(target: DropTarget, grabMin: number, oldStart: Date): Date {
  if (target.minutes === null) return slotDate(target.dayKey, wallMinutes(oldStart));
  return slotDate(target.dayKey, snapMinutes(target.minutes - grabMin, SNAP_MIN, 1440 - SNAP_MIN));
}

function slotPreview(start: Date, end: Date | null, label: string): DropPreview {
  const s = wallMinutes(start);
  const sameDay = end && dayKey(end) === dayKey(start);
  const e = end ? (sameDay ? wallMinutes(end) : 1440) : s + POINT_MIN;
  return { dayKey: dayKey(start), startMin: s, endMin: Math.max(e, s + SNAP_MIN), label };
}

/**
 * What dropping `source` on `target` would do, or null when it would change
 * nothing (dropped where it was).
 */
export function planDrop(source: DragSource, target: DropTarget, now: Date): DropPlan | null {
  if (source.kind === 'ticket') {
    return { kind: 'due', ticketId: source.ticketId, title: source.title, item: null, dayKey: target.dayKey, preview: { dayKey: target.dayKey, startMin: null, endMin: null, label: `Due ${fmtDay(target.dayKey)}` } };
  }
  const { item } = source;

  if (item.type === 'ticket.due' && item.ticket && source.kind === 'move') {
    if (target.dayKey === item.start) return null;
    return { kind: 'due', ticketId: item.ticket.id, title: item.title, item, dayKey: target.dayKey, preview: { dayKey: target.dayKey, startMin: null, endMin: null, label: `Due ${fmtDay(target.dayKey)}` } };
  }

  if (item.type === 'routine.upcoming' && item.routine?.triggerKind === 'once' && source.kind === 'move') {
    const old = new Date(item.start);
    const at = droppedStart(target, source.grabMin, old);
    if (at.getTime() === old.getTime()) return null;
    const label = `${fmtDay(dayKey(at))} ${fmtTime(at)}`;
    const preview = target.minutes === null
      ? { dayKey: target.dayKey, startMin: null, endMin: null, label }
      : slotPreview(at, null, label);
    if (isPast(at, now)) return { kind: 'refused', reason: 'A routine cannot be scheduled in the past', preview: { ...preview, label: `${label} (past)` } };
    return { kind: 'routine', item, routineId: item.routine.id, runAt: at.toISOString(), preview };
  }

  if (item.type === 'event' && item.event) {
    const ev = item.event;
    const series = !!ev.recurrence;
    if (item.shape === 'allDay') {
      if (source.kind !== 'move') return null;
      // An all-day chip grabbed on its 3rd day moves by the distance from that day.
      const delta = { days: dayDiff(item.start, target.dayKey) - Math.floor(source.grabMin / 1440), minutes: 0 };
      if (!delta.days) return null;
      const occ = applyDelta({ allDay: true, start: item.start, end: item.end ?? item.start }, delta);
      const label = occ.end !== occ.start ? `${fmtDay(occ.start)} - ${fmtDay(occ.end)}` : fmtDay(occ.start);
      return {
        kind: 'event', item, eventId: ev.id, edge: 'both', delta, series,
        patch: applyDelta(ev, delta), preview: { dayKey: target.dayKey, startMin: null, endMin: null, label },
      };
    }
    const oldStart = new Date(item.start);
    const oldEnd = new Date(item.end ?? item.start);
    if (source.kind === 'resize') {
      if (target.minutes === null) return null;
      let newEnd = slotDate(target.dayKey, snapMinutes(target.minutes));
      const minEnd = new Date(oldStart.getTime() + SNAP_MIN * 60_000);
      if (newEnd < minEnd) newEnd = minEnd;
      const delta = wallDelta(oldEnd, newEnd);
      if (!delta.days && !delta.minutes) return null;
      return {
        kind: 'event', item, eventId: ev.id, edge: 'end', delta, series,
        patch: applyEndDelta(ev, delta), preview: slotPreview(oldStart, newEnd, `${fmtTime(oldStart)} - ${fmtTime(newEnd)}`),
      };
    }
    const newStart = droppedStart(target, source.grabMin, oldStart);
    const delta = wallDelta(oldStart, newStart);
    if (!delta.days && !delta.minutes) return null;
    const occ = applyDelta({ allDay: false, start: item.start, end: oldEnd.toISOString() }, delta);
    const ns = new Date(occ.start);
    const ne = new Date(occ.end);
    const label = `${fmtDay(dayKey(ns))} ${fmtTime(ns)} - ${fmtTime(ne)}`;
    return {
      kind: 'event', item, eventId: ev.id, edge: 'both', delta, series,
      patch: applyDelta(ev, delta),
      preview: target.minutes === null ? { dayKey: target.dayKey, startMin: null, endMin: null, label } : slotPreview(ns, ne, label),
    };
  }
  return null;
}

/** The occurrence as it looks after the plan — the optimistic override. */
export function applyPlanToItem(plan: Extract<DropPlan, { kind: 'event' }>, it: AgendaItem): AgendaItem {
  const times: EventTimes = { allDay: it.shape === 'allDay', start: it.start, end: it.end ?? it.start };
  const moved = plan.edge === 'both' ? applyDelta(times, plan.delta) : applyEndDelta(times, plan.delta);
  return { ...it, ...moved };
}
