/**
 * Pure date & layout helpers for /agenda. Everything is in the browser's
 * local time zone: a "day" is local midnight → next local midnight, and items
 * are positioned from their local hours/minutes (never ms-since-midnight, which
 * drifts by an hour on DST days).
 */
import type { AgendaItem, AgendaItemType, AgendaPrefs, AgendaView } from '@fleex/shared';

export const DAY_MS = 24 * 3600_000;
/** Minimum rendered duration in the grid, so a 3-second run is still clickable. */
export const MIN_BLOCK_MIN = 22;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** Monday 00:00 of the week containing `d`. */
export function weekStart(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** Local 'YYYY-MM-DD'. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDayKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/**
 * The window to fetch for a view: one day, Mon→Mon, a 6-week month grid
 * starting on the Monday on/before the 1st, or 4 weeks for the schedule list.
 */
export function windowFor(view: AgendaView, anchor: Date): { from: Date; to: Date } {
  if (view === 'day') {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (view === 'week') {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 7) };
  }
  if (view === 'month') {
    const from = weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return { from, to: addDays(from, 42) };
  }
  const from = weekStart(anchor);
  return { from, to: addDays(from, 28) };
}

/** Move the anchor one period forward (+1) or back (-1). */
export function shiftAnchor(view: AgendaView, anchor: Date, dir: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return addDays(anchor, 7 * dir * (view === 'schedule' ? 4 : 1));
}

const endOf = (item: AgendaItem, now: Date) => (item.end ? new Date(item.end) : now);

/** The last local day a block touches; a block ending at 00:00 sharp does not touch the next day. */
function lastDayOf(item: AgendaItem, now: Date): Date {
  const start = new Date(item.start);
  const end = endOf(item, now);
  return startOfDay(new Date(Math.max(start.getTime(), end.getTime() - 1)));
}

/** Calendar days a block covers (1 for a point or a same-day block). */
export function daysCovered(item: AgendaItem, now: Date): number {
  if (item.shape !== 'block') return 1;
  const first = startOfDay(new Date(item.start));
  return Math.round((lastDayOf(item, now).getTime() - first.getTime()) / DAY_MS) + 1;
}

/**
 * Google-Calendar rule: a block over 3+ calendar days goes to the all-day band
 * as a bar; 1–2 days stay in the grid (a 2-day block is cut at midnight).
 */
export function isBar(item: AgendaItem, now: Date): boolean {
  return item.shape === 'block' && daysCovered(item, now) >= 3;
}

/** Local day keys an item appears on (for the month grid and day counts). */
export function itemDays(item: AgendaItem, now: Date): string[] {
  if (item.shape === 'allDay') return [item.start];
  const first = startOfDay(new Date(item.start));
  if (item.shape !== 'block') return [dayKey(first)];
  const last = lastDayOf(item, now);
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(dayKey(d));
  return out;
}

/** One piece of an item inside a day column. Minutes are local, 0–1440. */
export interface DaySegment {
  item: AgendaItem;
  startMin: number;
  endMin: number;
  /** The block began on an earlier day (draw "↑ cont."). */
  continuesBefore: boolean;
  /** The block goes on past midnight (draw "↓"). */
  continuesAfter: boolean;
  /** The instants this piece covers — used to clip the wait hatching. */
  from: Date;
  to: Date;
}

/** The piece of a grid item (point or ≤2-day block) inside `day`, or null. */
export function segmentForDay(item: AgendaItem, day: Date, now: Date): DaySegment | null {
  if (item.shape === 'allDay' || isBar(item, now)) return null;
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const start = new Date(item.start);
  if (item.shape === 'point') {
    if (start < dayStart || start >= dayEnd) return null;
    const s = minutesOfDay(start);
    return { item, startMin: s, endMin: Math.min(1440, s + MIN_BLOCK_MIN), continuesBefore: false, continuesAfter: false, from: start, to: start };
  }
  const end = endOf(item, now);
  if (!(start < dayEnd && (end > dayStart || dayKey(start) === dayKey(dayStart)))) return null;
  const before = start < dayStart;
  const after = end > dayEnd;
  const from = before ? dayStart : start;
  const to = after ? dayEnd : end;
  const startMin = before ? 0 : minutesOfDay(start);
  const rawEnd = after ? 1440 : startMin + (to.getTime() - from.getTime()) / 60_000;
  return {
    item, startMin, endMin: Math.min(1440, Math.max(rawEnd, startMin + MIN_BLOCK_MIN)),
    continuesBefore: before, continuesAfter: after, from, to,
  };
}

/** A grid entry: one segment, or several same-routine items of one hour merged into ×N. */
export type GridEntry =
  | { kind: 'item'; seg: DaySegment; startMin: number; endMin: number; col: number; cols: number }
  | { kind: 'group'; items: AgendaItem[]; startMin: number; endMin: number; col: number; cols: number };

/**
 * More than 2 short items of the same type (and same routine) in the same
 * hour collapse into one "×N" chip. Workflow runs never merge: two runs of
 * the same workflow are almost always on different tickets.
 */
export function groupHourly(segs: DaySegment[]): GridEntry[] {
  const buckets = new Map<string, DaySegment[]>();
  const out: GridEntry[] = [];
  for (const s of segs) {
    const short = s.endMin - s.startMin <= 30;
    if (s.item.type === 'workflow.run' || !short) {
      out.push({ kind: 'item', seg: s, startMin: s.startMin, endMin: s.endMin, col: 0, cols: 1 });
      continue;
    }
    const key = `${s.item.type}|${s.item.routine?.id ?? ''}|${Math.floor(s.startMin / 60)}`;
    const b = buckets.get(key);
    if (b) b.push(s);
    else buckets.set(key, [s]);
  }
  for (const b of buckets.values()) {
    if (b.length > 2) {
      const h = Math.floor(b[0]!.startMin / 60) * 60;
      out.push({ kind: 'group', items: b.map((s) => s.item), startMin: h, endMin: h + MIN_BLOCK_MIN, col: 0, cols: 1 });
    } else {
      for (const s of b) out.push({ kind: 'item', seg: s, startMin: s.startMin, endMin: s.endMin, col: 0, cols: 1 });
    }
  }
  return out;
}

/**
 * Overlap layout. Entries that overlap get distinct columns (`col` of `cols`);
 * the view renders them as a Google-Calendar cascade (each later column offset
 * to the right and drawn on top) so a 4-run burst stays readable.
 */
export function layoutDay<T extends { startMin: number; endMin: number; col: number; cols: number }>(entries: T[]): T[] {
  const sorted = [...entries].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster: T[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    for (const e of cluster) {
      let i = colEnds.findIndex((end) => end <= e.startMin);
      if (i < 0) {
        i = colEnds.length;
        colEnds.push(0);
      }
      colEnds[i] = e.endMin;
      e.col = i;
    }
    for (const e of cluster) e.cols = colEnds.length;
    cluster = [];
    clusterEnd = -1;
  };
  for (const e of sorted) {
    if (cluster.length && e.startMin >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  if (cluster.length) flush();
  return sorted;
}

/** Every label is on unless the user turned it off. */
export function labelOn(prefs: AgendaPrefs, type: AgendaItemType): boolean {
  return prefs.labels[type] !== false;
}

/**
 * Whether an item survives the sidebar: its label, its routine checkbox, and
 * the board / tag filters. An item without the filtered field (a routine run
 * has no board) passes the filter — hiding it would make the filter lie.
 */
export function isVisible(item: AgendaItem, prefs: AgendaPrefs): boolean {
  if (!labelOn(prefs, item.type)) return false;
  if (item.routine && prefs.routines[item.routine.id] === false) return false;
  const { boards, tags } = prefs.filters;
  if (boards.length && item.ticket && !boards.includes(item.ticket.boardId)) return false;
  if (tags.length && item.ticket && item.ticket.tags.length && !item.ticket.tags.some((t) => tags.includes(t))) return false;
  return true;
}

/** Search: title, `#123`, ticket title, workflow and routine names. */
export function matchesQuery(item: AgendaItem, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^#/, '');
  if (!needle) return true;
  const hay = [
    item.title, item.workflowName, item.routine?.name, item.prRef,
    item.ticket ? `${item.ticket.displayId} ${item.ticket.title}` : null,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

/** "4 h 32", "2 d 3 h", "12 min", "18 s". */
export function formatDuration(ms: number): string {
  const m = Math.max(0, ms) / 60_000;
  if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;
  return `${Math.floor(m / 1440)} d ${Math.round((m % 1440) / 60)} h`;
}

/** "Spec Dev PR (HITL)" → "Spec Dev PR". */
export function workflowShortName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
}

/** The wait a run is in right now, if any. */
export function openWait(item: AgendaItem) {
  return item.segments?.find((s) => s.end === null) ?? null;
}
