/**
 * Placement of the todo marks in their strip under the frieze (SPEC
 * todo-timeline §3.3) — pure, no React.
 *
 * Like annotations, todo marks take no slot in `layoutTimeline`: their x is
 * interpolated on the frieze's time ↔ x mapping, so a burst of 8 items never
 * widens it nor moves a picto. Marks close on screen merge into one chip with
 * a counter per kind; since grouping is in pixels, zooming in splits a burst.
 */
import { xAtTime, type TimeAnchor } from './layoutAnnotations';
import { TODO_MARK_KINDS, type TodoMark, type TodoMarkKind } from './todoMarks';

/** Strip height, and the chip inside it. */
export const TODO_STRIP = 30;
export const CHIP_H = 18;
export const CHIP_TOP = (TODO_STRIP - CHIP_H) / 2;
/** Minimum gap between two chips; a mark closer than this to a chip joins it. */
export const CHIP_GAP = 4;
/** Room kept at the strip's left edge for its sticky "Todo" label. */
export const TODO_LABEL_W = 48;
/** One segment: 11px icon + 2px gap + 6px per digit. */
const SEG_ICON = 13;
const DIGIT_W = 6;
const SEG_GAP = 3;
const CHIP_PAD = 10;

export interface PlacedTodoMark extends TodoMark {
  /** Exact x of its instant. */
  x: number;
}

export interface TodoChip {
  /** Stable id: its first mark's. */
  key: string;
  marks: PlacedTodoMark[];
  counts: Partial<Record<TodoMarkKind, number>>;
  /** Span of its marks' x. */
  minX: number;
  maxX: number;
  left: number;
  width: number;
  /** The kind with the most marks (border and hover lines take its hue). */
  dominant: TodoMarkKind;
}

export interface TodoStrip {
  chips: TodoChip[];
  height: number;
}

/** A chip's width: a round pill for one mark, else one segment per non-empty kind. */
export function chipWidth(counts: Partial<Record<TodoMarkKind, number>>): number {
  const kinds = TODO_MARK_KINDS.filter((k) => counts[k]);
  const total = kinds.reduce((n, k) => n + counts[k]!, 0);
  if (total <= 1) return CHIP_H;
  return CHIP_PAD + kinds.reduce((w, k) => w + SEG_ICON + DIGIT_W * String(counts[k]).length, 0) + SEG_GAP * (kinds.length - 1);
}

/** The strip's height: none when filtered out or when there is nothing to show. */
export function todoStripHeight(marks: readonly TodoMark[], enabled: boolean): number {
  return enabled && marks.length > 0 ? TODO_STRIP : 0;
}

export function layoutTodoStrip(marks: readonly TodoMark[], anchors: readonly TimeAnchor[], width: number): TodoStrip {
  if (marks.length === 0 || anchors.length === 0) return { chips: [], height: 0 };
  const placed = marks
    .map((m) => ({ ...m, x: xAtTime(anchors, m.at) }))
    .sort((a, b) => a.at - b.at || a.x - b.x);

  // Greedy: a mark joins the current group when it falls within its chip (+ gap).
  const groups: { marks: PlacedTodoMark[]; counts: Partial<Record<TodoMarkKind, number>>; minX: number; maxX: number }[] = [];
  for (const m of placed) {
    const g = groups[groups.length - 1];
    if (g) {
      const right = (g.minX + g.maxX) / 2 + chipWidth(g.counts) / 2;
      if (m.x <= right + CHIP_GAP) {
        g.marks.push(m);
        g.counts[m.kind] = (g.counts[m.kind] ?? 0) + 1;
        g.maxX = Math.max(g.maxX, m.x);
        continue;
      }
    }
    groups.push({ marks: [m], counts: { [m.kind]: 1 }, minX: m.x, maxX: m.x });
  }

  // Centred on their span, kept inside the strip, never overlapping the previous chip.
  let prevRight = -Infinity;
  const chips = groups.map((g): TodoChip => {
    const w = chipWidth(g.counts);
    const centred = Math.min((g.minX + g.maxX) / 2 - w / 2, width - 4 - w);
    const left = Math.max(centred, TODO_LABEL_W, prevRight + CHIP_GAP);
    prevRight = left + w;
    const dominant = TODO_MARK_KINDS.reduce<TodoMarkKind | null>(
      (best, k) => ((g.counts[k] ?? 0) > (best ? g.counts[best] ?? 0 : 0) ? k : best),
      null,
    )!;
    return { key: g.marks[0]!.id, marks: g.marks, counts: g.counts, minX: g.minX, maxX: g.maxX, left, width: w, dominant };
  });
  return { chips, height: TODO_STRIP };
}
