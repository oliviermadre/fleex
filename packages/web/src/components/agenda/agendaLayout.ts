/**
 * Pure date & layout helpers for /agenda. Everything is in the browser's
 * local time zone: a "day" is local midnight → next local midnight, and items
 * are positioned from their local hours/minutes (never ms-since-midnight, which
 * drifts by an hour on DST days).
 */
import { matchesAgendaFilters, matchesAgendaQuery, type AgendaItem, type AgendaItemType, type AgendaPrefs, type AgendaView } from '@fleex/shared';

export const DAY_MS = 24 * 3600_000;
/** Height of one hour in the Day / Week grid. 60 px: one minute is one pixel. */
export const HOUR_PX = 60;
/**
 * Rendered height (in minutes, = px at HOUR_PX 60) of an instant and of any
 * block shorter than that: a 3-second run is still a clickable 18 px row, and
 * the layout reserves exactly the space it is drawn in, so it never sits on a
 * neighbour.
 */
export const POINT_MIN = 18;
/** Kept for callers of the old name. */
export const MIN_BLOCK_MIN = POINT_MIN;
/**
 * Visible columns per overlap cluster before the rest folds into "+N". Workflow
 * runs are not counted: they live in their own narrow lanes (`assignLanes`).
 */
export const MAX_COLS = { day: 8, week: 3 } as const;
/** Max width of one workflow lane: a thin band, so the rest keeps the room. */
export const LANE_PX = 20;
/** The lanes never take more than this share of a day column. */
export const LANES_MAX_SHARE = 0.45;

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

/**
 * ISO 8601 week number (weeks start Monday, week 1 holds the year's first
 * Thursday) — the same numbering as Google Calendar and the "FW 2026-W45" epics.
 */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // Thursday of this week
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
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
  if (item.shape === 'allDay') {
    // A multi-day all-day event (E1) carries its inclusive last day in `end`.
    if (!item.end || item.end <= item.start) return [item.start];
    const out: string[] = [];
    for (let d = parseDayKey(item.start), k = item.start; k <= item.end && out.length < 366; d = addDays(d, 1), k = dayKey(d)) out.push(k);
    return out;
  }
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
  /** The block began on an earlier day (draw an up arrow + "cont."). */
  continuesBefore: boolean;
  /** The block goes on past midnight (draw a down arrow). */
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
    // Pulled up at 23:50 so the row keeps its full height inside the day.
    const s = Math.min(minutesOfDay(start), 1440 - POINT_MIN);
    return { item, startMin: s, endMin: s + POINT_MIN, continuesBefore: false, continuesAfter: false, from: start, to: start };
  }
  const end = endOf(item, now);
  if (!(start < dayEnd && (end > dayStart || dayKey(start) === dayKey(dayStart)))) return null;
  const before = start < dayStart;
  const after = end > dayEnd;
  const from = before ? dayStart : start;
  const to = after ? dayEnd : end;
  let startMin = before ? 0 : minutesOfDay(start);
  const rawEnd = after ? 1440 : startMin + (to.getTime() - from.getTime()) / 60_000;
  // A short run is drawn (and laid out) as an instant row.
  if (rawEnd - startMin < POINT_MIN) startMin = Math.min(startMin, 1440 - POINT_MIN);
  return {
    item, startMin, endMin: Math.min(1440, Math.max(rawEnd, startMin + POINT_MIN)),
    continuesBefore: before, continuesAfter: after, from, to,
  };
}

/**
 * A grid entry: one segment, several same-routine items of one hour merged
 * into ×N, or a "+N" chip holding what did not fit in the visible columns.
 * After `layoutDay`, an entry is drawn from column `col` over `span` columns,
 * out of `cols` for its overlap cluster.
 */
interface Placed { startMin: number; endMin: number; col: number; cols: number; span: number }
export type GridEntry =
  | ({ kind: 'item'; seg: DaySegment } & Placed)
  | ({ kind: 'group'; items: AgendaItem[] } & Placed)
  | ({ kind: 'more'; items: AgendaItem[] } & Placed);

const placed = (startMin: number, endMin: number): Placed => ({ startMin, endMin, col: 0, cols: 1, span: 1 });

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
    if (isBand(s.item) || !short) {
      out.push({ kind: 'item', seg: s, ...placed(s.startMin, s.endMin) });
      continue;
    }
    const key = `${s.item.type}|${s.item.routine?.id ?? ''}|${Math.floor(s.startMin / 60)}`;
    const b = buckets.get(key);
    if (b) b.push(s);
    else buckets.set(key, [s]);
  }
  for (const b of buckets.values()) {
    if (b.length > 2) {
      const h = Math.min(b[0]!.startMin, ...b.map((s) => s.startMin));
      out.push({ kind: 'group', items: b.map((s) => s.item), ...placed(h, h + POINT_MIN) });
    } else {
      for (const s of b) out.push({ kind: 'item', seg: s, ...placed(s.startMin, s.endMin) });
    }
  }
  return out;
}

/**
 * Workflow runs are drawn as thin vertical bands on the left of the day
 * column, one lane each — never grouped, never folded into "+N": a run that
 * started yesterday must show in both columns, not hide in a "+2". Lanes are
 * packed first-free, so two runs that don't overlap share a lane.
 */
export function assignLanes(segs: DaySegment[]): { lanes: number; placed: { seg: DaySegment; lane: number }[] } {
  const sorted = [...segs].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const ends: number[] = [];
  const placedSegs = sorted.map((seg) => {
    let lane = ends.findIndex((end) => end <= seg.startMin);
    if (lane < 0) {
      lane = ends.length;
      ends.push(0);
    }
    ends[lane] = seg.endMin;
    return { seg, lane };
  });
  return { lanes: ends.length, placed: placedSegs };
}

const overlaps = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) =>
  a.startMin < b.endMin && b.startMin < a.endMin;

const itemsOf = (e: GridEntry): AgendaItem[] => (e.kind === 'item' ? [e.seg.item] : e.items);

/**
 * Overlap layout — nothing is ever drawn on top of anything.
 *
 * 1. Entries are cut into clusters (chains of overlapping entries) and each
 *    cluster is packed into columns, first free column wins (longest first
 *    on a tie, so a long block takes the left edge).
 * 2. A cluster that needs more than `maxCols` columns keeps its first
 *    `maxCols − 1` columns; the last visible column takes what was packed
 *    there and beyond, one entry at a time: an entry that overlaps no other
 *    such entry and finds the column free is drawn, the others fold into a
 *    "+N" chip (one per hour, POINT_MIN tall, stacked below the previous
 *    thing in that column).
 * 3. Expand: each drawn entry widens to the right over every column that is
 *    free for its whole duration.
 *
 * The returned entries (items, ×N groups and "+N" chips) are disjoint
 * rectangles: same column ⇒ disjoint times; overlapping times ⇒ disjoint
 * column ranges.
 */
export function layoutDay(entries: GridEntry[], maxCols = Infinity): GridEntry[] {
  const cap = Math.max(2, maxCols);
  const sorted = [...entries].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: GridEntry[] = [];
  let cluster: GridEntry[] = [];
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
    let shown = cluster;
    let cols = colEnds.length;
    if (cols > cap) {
      cols = cap;
      const last = cap - 1;
      shown = cluster.filter((e) => e.col < last);
      const rest = cluster.filter((e) => e.col >= last);
      let lastEnd = -1;
      let chip: Extract<GridEntry, { kind: 'more' }> | null = null;
      let chipHour = -1;
      for (const e of rest) {
        const lonely = !rest.some((o) => o !== e && overlaps(o, e));
        if (lonely && e.startMin >= lastEnd) {
          e.col = last;
          shown.push(e);
          lastEnd = e.endMin;
          continue;
        }
        const hour = Math.floor(e.startMin / 60);
        const start = Math.max(lastEnd, e.startMin);
        if (chip && (hour === chipHour || start + POINT_MIN > 1440)) {
          chip.items.push(...itemsOf(e));
          continue;
        }
        chip = { kind: 'more', items: [...itemsOf(e)], ...placed(start, start + POINT_MIN), col: last };
        chipHour = hour;
        shown.push(chip);
        lastEnd = chip.endMin;
      }
    }
    for (const e of shown) {
      e.cols = cols;
      e.span = 1;
    }
    for (const e of shown) {
      let span = 1;
      while (e.col + span < cols && !shown.some((o) => o !== e && o.col <= e.col + span && o.col + o.span > e.col + span && overlaps(o, e))) span++;
      e.span = span;
    }
    out.push(...shown.sort((a, b) => a.startMin - b.startMin || a.col - b.col));
    cluster = [];
    clusterEnd = -1;
  };

  for (const e of sorted) {
    if (cluster.length && e.startMin >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  if (cluster.length) flush();
  return out;
}

/** Runs drawn as thin bands in their own lanes: workflow runs and SDK agent runs. */
export function isBand(item: AgendaItem): boolean {
  return item.type === 'workflow.run' || item.type === 'agent.run';
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
  if (item.type === 'external' && item.external?.eventType === 'workingLocation' && !prefs.showWorkingLocation) return false;
  return matchesAgendaFilters(item, prefs.filters);
}

/** Search: title, `#123`, ticket title, workflow and routine names (shared with the CLI). */
export const matchesQuery = matchesAgendaQuery;

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

/** Two agent runs on one ticket at most this far apart belong to the same session. */
export const SESSION_GAP_MIN = 15;

/**
 * Agent runs come in bursts of back-and-forth on one ticket (a run, a reply, a
 * run…), each a few minutes long. Drawn one by one they inflate to POINT_MIN
 * and stair-step across many lanes. Runs on the same ticket that follow each
 * other within SESSION_GAP_MIN are merged into one session item, spanning the
 * first start to the last end; `runsOf` maps its id to the runs, oldest first.
 * A lone run, a run without a ticket and every other item pass through as is.
 */
export function groupAgentSessions(items: AgendaItem[], now: Date): { items: AgendaItem[]; runsOf: Map<string, AgendaItem[]> } {
  const runsOf = new Map<string, AgendaItem[]>();
  const byTicket = new Map<string, AgendaItem[]>();
  const out: AgendaItem[] = [];
  for (const it of items) {
    if (it.type === 'agent.run' && it.shape === 'block' && it.ticket) {
      const list = byTicket.get(it.ticket.id) ?? [];
      list.push(it);
      byTicket.set(it.ticket.id, list);
    } else out.push(it);
  }
  for (const runs of byTicket.values()) {
    runs.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    let session: AgendaItem[] = [];
    let sessionEnd = 0;
    const flush = () => {
      if (session.length === 1) out.push(session[0]!);
      else if (session.length > 1) {
        const first = session[0]!;
        const last = session[session.length - 1]!;
        const running = session.some((r) => r.status === 'running');
        const id = `agent.session:${first.id}`;
        out.push({
          ...first,
          id,
          start: first.start,
          end: running ? null : new Date(sessionEnd).toISOString(),
          status: running ? 'running' : last.status,
        });
        runsOf.set(id, session);
      }
    };
    for (const r of runs) {
      const s = new Date(r.start).getTime();
      if (session.length && s - sessionEnd > SESSION_GAP_MIN * 60_000) {
        flush();
        session = [];
      }
      session.push(r);
      sessionEnd = Math.max(session.length === 1 ? 0 : sessionEnd, endOf(r, now).getTime());
    }
    flush();
  }
  return { items: out, runsOf };
}
