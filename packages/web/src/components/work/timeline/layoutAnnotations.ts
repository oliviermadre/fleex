/**
 * Placement of the Timeline annotations (SPEC annotations §5) — pure, no React.
 *
 * Annotations are NOT laid out by `layoutTimeline`: they take no slot in any
 * lane, so adding one never widens the frieze nor moves a picto. Their X is
 * interpolated between the placed events around their instant (the frieze is
 * monotonic, so the time ↔ x mapping is too), and the inverse mapping turns a
 * cursor position into the instant to annotate. Cards live in their own band
 * above the frieze, with their own collision handling (2nd row, then stacks).
 */
import type { AnnotationTone, TimelineAnnotation } from '@fleex/shared';
import type { TintHue } from '../../../lib/tints';
import type { TimelineLayout } from './layoutTimeline';

export const CARD_W = 200;
export const CARD_H = 56;
const CARD_GAP = 8;
const ROW_GAP = 6;
/** Snap the cursor to a node closer than this (px). */
export const SNAP_PX = 8;
/** More than this many cards within one card width are grouped into a stack. */
const STACK_OVER = 3;

/** Band height: none when filtered out, a thin strip to hover when empty, one or two rows. */
export const BAND = { hidden: 0, empty: 16, oneRow: 72, twoRows: 132 } as const;

export const TONE_HUE: Record<AnnotationTone, TintHue> = {
  info: 'blue',
  highlight: 'yellow',
  warning: 'orange',
  success: 'green',
};

export const TONE_LABEL: Record<AnnotationTone, string> = {
  info: 'info',
  highlight: 'mise en avant',
  warning: 'attention',
  success: 'succès',
};

/** A (time, x) pair of the frieze; the list is strictly increasing on both. */
export interface TimeAnchor {
  at: number;
  x: number;
}

/**
 * The frieze's time ↔ x mapping: every time-driven (non-attached) placed
 * event, then "now". Attached pictos sit at their parent's x, not at their own
 * instant, so they would bend the mapping — they are left out.
 */
export function timeAnchors(layout: TimelineLayout, now: number): TimeAnchor[] {
  const out: TimeAnchor[] = [];
  const push = (at: number, x: number) => {
    const last = out[out.length - 1];
    if (!last || (at > last.at && x > last.x)) out.push({ at, x });
  };
  for (const it of layout.items) if (!it.attached) push(it.event.at, it.x);
  push(now, layout.nowX);
  return out;
}

/** Instant → x, linear between the two anchors around it, clamped to the frieze. */
export function xAtTime(anchors: readonly TimeAnchor[], at: number): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) return 0;
  if (at <= first.at) return first.x;
  if (at >= last.at) return last.x;
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]!;
    if (at <= b.at) {
      const a = anchors[i - 1]!;
      return a.x + ((at - a.at) / (b.at - a.at)) * (b.x - a.x);
    }
  }
  return last.x;
}

/** x → instant: the inverse of `xAtTime` (rounded to the minute, as the composer shows minutes). */
export function timeAtX(anchors: readonly TimeAnchor[], x: number): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) return Date.now();
  if (x <= first.x) return first.at;
  if (x >= last.x) return last.at;
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]!;
    if (x <= b.x) {
      const a = anchors[i - 1]!;
      return Math.round(a.at + ((x - a.x) / (b.x - a.x)) * (b.at - a.at));
    }
  }
  return last.at;
}

export interface CursorInstant {
  at: number;
  x: number;
  /** The node the cursor snapped to (its exact timestamp), or null. */
  snappedTo: { id: string; label: string } | null;
}

/** What instant the cursor at `x` designates: a node's exact timestamp within SNAP_PX, else the interpolation. */
export function instantAtCursor(layout: TimelineLayout, anchors: readonly TimeAnchor[], x: number): CursorInstant {
  let best: TimelineLayout['items'][number] | null = null;
  for (const it of layout.items) {
    if (it.event.lane === 'status') continue;
    const d = Math.abs(it.x - x);
    if (d <= SNAP_PX && (!best || d < Math.abs(best.x - x))) best = it;
  }
  if (best) return { at: best.event.at, x: best.x, snappedTo: { id: best.event.id, label: best.event.label } };
  const lastX = anchors[anchors.length - 1]?.x ?? x;
  const cx = Math.min(x, lastX);
  return { at: timeAtX(anchors, cx), x: cx, snappedTo: null };
}

// ── Cards ─────────────────────────────────────────────────────────────────────

export interface PlacedAnnotation<A extends TimelineAnnotation = TimelineAnnotation> {
  annotation: A;
  /** Exact x of its instant — where the dotted anchor falls. */
  x: number;
}

export type PlacedCard<A extends TimelineAnnotation = TimelineAnnotation> =
  | { kind: 'card'; item: PlacedAnnotation<A>; left: number; row: 0 | 1 }
  | { kind: 'stack'; items: PlacedAnnotation<A>[]; left: number; row: 0 | 1 };

export interface AnnotationBand<A extends TimelineAnnotation = TimelineAnnotation> {
  cards: PlacedCard<A>[];
  height: number;
}

const itemsOf = <A extends TimelineAnnotation>(c: PlacedCard<A>) => (c.kind === 'card' ? [c.item] : c.items);

function centeredLeft(x: number, width: number): number {
  return Math.max(4, Math.min(x - CARD_W / 2, width - CARD_W - 4));
}

/**
 * Cards centred on their instant (shifted to stay inside the frieze — the
 * anchor keeps the exact x). Overlap → second row; more than STACK_OVER cards
 * within one card width, or no room on either row → one "N annotations" stack.
 */
export function layoutAnnotationBand<A extends TimelineAnnotation>(
  annotations: readonly A[],
  anchors: readonly TimeAnchor[],
  width: number,
  enabled = true,
): AnnotationBand<A> {
  if (!enabled) return { cards: [], height: BAND.hidden };
  if (annotations.length === 0) return { cards: [], height: BAND.empty };

  const items = annotations
    .map((a) => ({ annotation: a, x: xAtTime(anchors, Date.parse(a.at)) }))
    .sort((p, q) => p.x - q.x || Date.parse(p.annotation.at) - Date.parse(q.annotation.at));

  // 1) Dense clusters become stacks up front.
  const groups: PlacedAnnotation<A>[][] = [];
  for (let i = 0; i < items.length; ) {
    let j = i;
    while (j + 1 < items.length && items[j + 1]!.x - items[i]!.x < CARD_W) j++;
    if (j - i + 1 > STACK_OVER) {
      groups.push(items.slice(i, j + 1));
      i = j + 1;
    } else {
      groups.push([items[i]!]);
      i++;
    }
  }

  // 2) Rows: first row that has room, else merge into the last card of row 2.
  const rows: [PlacedCard<A>[], PlacedCard<A>[]] = [[], []];
  for (const g of groups) {
    const x = g.length === 1 ? g[0]!.x : (g[0]!.x + g[g.length - 1]!.x) / 2;
    const left = centeredLeft(x, width);
    const row = ([0, 1] as const).find((r) => {
      const last = rows[r][rows[r].length - 1];
      return !last || left >= last.left + CARD_W + CARD_GAP;
    });
    if (row !== undefined) {
      rows[row].push(g.length === 1 ? { kind: 'card', item: g[0]!, left, row } : { kind: 'stack', items: g, left, row });
      continue;
    }
    const prev = rows[1].pop()!;
    const merged = [...itemsOf(prev), ...g];
    const mx = (merged[0]!.x + merged[merged.length - 1]!.x) / 2;
    rows[1].push({ kind: 'stack', items: merged, left: centeredLeft(mx, width), row: 1 });
  }

  const cards = [...rows[0], ...rows[1]];
  return { cards, height: rows[1].length > 0 ? BAND.twoRows : BAND.oneRow };
}

/** Top y of a card in a band of `bandHeight` (row 0 sits right above the frieze). */
export function cardTop(row: 0 | 1, bandHeight: number): number {
  return bandHeight - 8 - CARD_H - (row === 0 ? 0 : CARD_H + ROW_GAP);
}

/** The card's thumbnail: the first image of the body, if any. */
export function firstImage(body: string): string | null {
  return /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/.exec(body)?.[1] ?? null;
}

/** Whether the body says more than the title (📎 on the card). */
export function hasMoreThanTitle(body: string): boolean {
  return body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim().length > 0;
}
