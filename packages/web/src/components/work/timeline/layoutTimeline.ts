/**
 * X/Y placement of the ticket Timeline (SPEC §7) — pure, no React.
 *
 * The X axis is chronological and MONOTONIC (an earlier event is never drawn
 * right of a later one, across lanes) but NOT linear: the gap between two
 * consecutive events grows with log(Δt) and is capped, so three idle days cost
 * ~180px and are flagged by a "⋯ 3 j" break instead of a screen of void.
 *
 * Each lane (status / top / spine / bottom) keeps its own minimum spacing, so
 * a burst in one lane spreads that lane only. Pictos attached to a spine node
 * (the deliverable a step produced, the comment a run posted) stack under
 * their parent instead of widening the frieze.
 */
import type { TimelineFilterKey } from '../../../stores/workStore';
import { sameLocalDay, type Lane, type TimelineEvent, type TimelineModel, type TimelineZone } from './buildTimeline';

// ── Parameters ────────────────────────────────────────────────────────────────

/** Minimum centre-to-centre spacing per lane (= the picto's slot width). */
export const LANE_WIDTH: Record<Lane, number> = { spine: 124, top: 34, bottom: 32, status: 0 };
/** The PR chip is wider than a round picto. */
export const PR_CHIP_WIDTH = 58;
export const PAD_LEFT = 24;
/** Attached pictos sit at the right edge of their parent's spine slot (between two labels). */
export const ATTACH_OFFSET = LANE_WIDTH.spine / 2;
/** Room right of the now line — wide enough for its "maintenant" label. */
export const PAD_RIGHT = 80;
/** A short frieze is stretched to fill the viewport, but never spread more than this. */
export const MAX_STRETCH = 3;
export const FORK_WIDTH = 320;
export const BREAK_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const MAX_GAP = 180;
const NOTE_MAX = 150;
const PRIORITY_TEXT_MAX = 210;
const MIN_TEXT = 40;

/** Fixed vertical geometry of the content band (SPEC §6.3). */
export const GEOMETRY = {
  height: 196,
  zoneBar: 2,
  statusY: 8,
  topY: 38,
  noteY: 80,
  spineY: 116,
  labelY: 136,
  bottomY: 170,
} as const;

/** Compressed time → px: 1 min ≈ 14px, 1 h ≈ 83px, 1 day ≈ 147px, capped at 180. */
export function gap(dtMs: number): number {
  if (dtMs <= 0) return 0;
  return Math.min(MAX_GAP, 14 * Math.log2(1 + dtMs / 60_000));
}

// ── Output ────────────────────────────────────────────────────────────────────

export interface PlacedEvent {
  event: TimelineEvent;
  x: number;
  /** Width of the picto's slot in its lane. */
  width: number;
  /** Drawn under / over its parent spine node (dotted connector). */
  attached: boolean;
  /** Room for the note (spine) or the priority text (top); null = hidden. */
  textWidth: number | null;
}

export interface PlacedZone extends TimelineZone {
  x0: number;
  x1: number;
}

export interface TimelineLayout {
  items: PlacedEvent[];
  byId: Map<string, PlacedEvent>;
  zones: PlacedZone[];
  /** Horizontal stretch applied so a short frieze fills the viewport (1 = none). */
  stretch: number;
  breaks: { x: number; label: string }[];
  days: { x: number; label: string }[];
  spine: { x0: number; x1: number; active: { x0: number; x1: number; workflow: boolean } | null };
  nowX: number;
  width: number;
}

export type TimelineFilters = Record<TimelineFilterKey, boolean>;

/** Whether the filters let an event through. The spine is never filterable. */
export function isVisible(e: TimelineEvent, f: TimelineFilters): boolean {
  switch (e.kind) {
    case 'status':
    case 'priority': return f.status;
    case 'cli': return f.cli;
    case 'pr': return f.pr;
    case 'deliverable': return f.deliverables;
    case 'comment': return f.comments;
    default: return true;
  }
}

function slotWidth(e: TimelineEvent): number {
  return e.kind === 'pr' ? PR_CHIP_WIDTH : LANE_WIDTH[e.lane];
}

/** Where a note starts, right of its node — past the replay badge when there is one. */
export function noteOffset(e: TimelineEvent): number {
  return e.attempt > 1 ? 38 : 14;
}

/**
 * How far right of its centre a picto occupies its lane. The priority picto
 * carries its text ("priorité : moyenne → haute") so it reserves that room in
 * the top lane — other top pictos move aside rather than hide the text.
 */
function rightExtent(e: TimelineEvent, w: number): number {
  if (e.kind !== 'priority') return w / 2;
  return 14 + 4 + Math.min(PRIORITY_TEXT_MAX, Math.ceil(e.label.length * 6.2)) + 8;
}

function breakLabel(dt: number): string {
  const h = dt / 3_600_000;
  return h >= 24 ? `⋯ ${Math.round(h / 24)} j` : `⋯ ${Math.round(h)} h`;
}

function dayLabel(t: number): string {
  return new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * `minWidth` = the viewport width: a frieze shorter than that is stretched
 * (every x scaled away from the left pad, up to MAX_STRETCH — gaps only grow,
 * so order and non-overlap hold) and the last status zone runs to the edge.
 */
export function layoutTimeline(model: TimelineModel, filters: TimelineFilters, minWidth = 0): TimelineLayout {
  const visible = model.events.filter((e) => isVisible(e, filters));
  const items: PlacedEvent[] = [];
  const byId = new Map<string, PlacedEvent>();
  const breaks: TimelineLayout['breaks'] = [];

  const lastRight: Record<Lane, number> = { spine: -Infinity, top: -Infinity, bottom: -Infinity, status: -Infinity };
  // `x` / `prevAt`: the last time-driven (primary) placement, which the next
  // gap is measured from. `floor`: the right-most x placed so far — nothing
  // placed later (so nothing later in time) may go left of it.
  let x = PAD_LEFT + LANE_WIDTH.spine / 2;
  let floor = x;
  let prevAt: number | null = null;
  let lastPrimaryAt = model.now;

  for (const e of visible) {
    const w = slotWidth(e);
    const parent = e.parentId ? byId.get(e.parentId) : undefined;
    const attached = !!parent && (e.lane === 'top' || e.lane === 'bottom');
    let at: number;

    if (attached) {
      // Stack in the parent's slot, at its right edge so the dotted connector
      // runs between two spine labels. Consumes no time spacing: the frieze
      // doesn't widen for it.
      at = Math.max(parent!.x + ATTACH_OFFSET, floor, lastRight[e.lane] + w / 2);
    } else if (prevAt == null) {
      at = x;
      prevAt = e.at;
    } else {
      const dt = e.at - prevAt;
      at = Math.max(x + gap(dt), floor, lastRight[e.lane] + w / 2);
      if (dt > BREAK_THRESHOLD_MS) breaks.push({ x: (x + at) / 2, label: breakLabel(dt) });
      x = at;
      prevAt = e.at;
    }
    if (!attached) lastPrimaryAt = e.at;
    floor = Math.max(floor, at);
    if (w > 0) lastRight[e.lane] = at + rightExtent(e, w);
    const placed: PlacedEvent = { event: e, x: at, width: w, attached, textWidth: null };
    items.push(placed);
    byId.set(e.id, placed);
  }

  const maxX = items.reduce((m, i) => Math.max(m, i.x), PAD_LEFT);
  let nowX = maxX + Math.max(LANE_WIDTH.spine / 2 + 16, gap(model.now - lastPrimaryAt));
  const fork = model.pendingFork && byId.has(model.pendingFork.anchorId) ? model.pendingFork : null;
  const tail = PAD_RIGHT + (fork ? FORK_WIDTH : 0);

  // Short frieze → stretch it to fill the viewport.
  let stretch = 1;
  if (nowX + tail < minWidth && nowX > PAD_LEFT) {
    stretch = Math.min(MAX_STRETCH, (minWidth - tail - PAD_LEFT) / (nowX - PAD_LEFT));
    const sx = (v: number) => PAD_LEFT + (v - PAD_LEFT) * stretch;
    for (const it of items) it.x = sx(it.x);
    for (const b of breaks) b.x = sx(b.x);
    nowX = sx(nowX);
  }
  const width = Math.max(minWidth, nowX + tail);

  // Text room: a note / priority label may run up to the next picto of its lane.
  const nextInLane = (idx: number, lane: Lane) => {
    for (let j = idx + 1; j < items.length; j++) if (items[j]!.event.lane === lane) return items[j]!.x;
    return null;
  };
  items.forEach((it, idx) => {
    if (it.event.lane === 'spine' && it.event.note) {
      const next = nextInLane(idx, 'spine') ?? nowX;
      const room = Math.min(NOTE_MAX, next - it.x - noteOffset(it.event) - 14);
      it.textWidth = room >= MIN_TEXT ? room : null;
    } else if (it.event.kind === 'priority') {
      const next = nextInLane(idx, 'top') ?? nowX;
      const room = Math.min(PRIORITY_TEXT_MAX, next - it.x - 24);
      it.textWidth = room >= MIN_TEXT ? room : null;
    }
  });

  // Day separators, between the last event of a day and the first of the next.
  const days: TimelineLayout['days'] = [];
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!;
    const b = items[i]!;
    if (!sameLocalDay(a.event.at, b.event.at)) days.push({ x: (a.x + b.x) / 2, label: dayLabel(b.event.at) });
  }

  // Status zones: each starts at its status event, the last runs to the end.
  const zones: PlacedZone[] = [];
  if (filters.status) {
    model.zones.forEach((z, i) => {
      const head = byId.get(z.eventId);
      const x0 = i === 0 ? PAD_LEFT - 12 : head ? head.x - 10 : PAD_LEFT - 12;
      zones.push({ ...z, x0, x1: width });
    });
    for (let i = 0; i < zones.length - 1; i++) zones[i]!.x1 = zones[i + 1]!.x0;
  }

  const spineItems = items.filter((i) => i.event.lane === 'spine');
  const agentic = spineItems.filter((i) => i.event.kind === 'step' || i.event.kind === 'run');
  const live = agentic.some((i) => i.event.state === 'running' || i.event.state === 'pending');
  const spine: TimelineLayout['spine'] = {
    x0: spineItems[0]?.x ?? PAD_LEFT,
    x1: nowX,
    active: agentic.length > 0
      ? { x0: agentic[0]!.x, x1: live ? nowX : agentic[agentic.length - 1]!.x, workflow: !!model.activeSpan?.workflow }
      : null,
  };

  return { items, byId, zones, stretch, breaks, days, spine, nowX, width };
}
