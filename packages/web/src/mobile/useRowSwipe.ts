import { useCallback, useRef, useState } from 'react';
import { AXIS_LOCK } from './useColumnSwipe';

/** Width (px) of the action revealed behind a row. */
export const ROW_ACTION_WIDTH = 96;
/** Share of the action width past which the row stays open on release. */
const OPEN_RATIO = 0.4;
const OPEN_VELOCITY = 0.3;
/** How much of the drag is kept past the action width. */
const OVERDRAG_RESISTANCE = 0.25;

/** Which side of the row shows its action: dragging right reveals `left`, dragging left reveals `right`. */
export type RowSide = 'left' | 'right';

/** Resting offset of a row: open on a side, or closed. */
export function rowOffset(open: RowSide | null, width = ROW_ACTION_WIDTH): number {
  return open === 'left' ? width : open === 'right' ? -width : 0;
}

/** Live offset while dragging: 1:1 up to the action width, damped past it. */
export function dragOffset(offset: number, width = ROW_ACTION_WIDTH): number {
  const abs = Math.abs(offset);
  if (abs <= width) return offset;
  return Math.sign(offset) * (width + (abs - width) * OVERDRAG_RESISTANCE);
}

/**
 * Where the row settles when the finger lifts: open on the side the offset
 * points to once it is past a share of the action (or flicked that way), closed
 * otherwise. A flick back toward the centre closes an open row.
 */
export function settleRow(p: { offset: number; velocity: number; width?: number }): RowSide | null {
  const width = p.width ?? ROW_ACTION_WIDTH;
  const dir = Math.sign(p.offset);
  if (dir === 0) return null;
  const towardCentre = Math.sign(p.velocity) === -dir && Math.abs(p.velocity) > OPEN_VELOCITY;
  if (towardCentre) return null;
  const far = Math.abs(p.offset) > width * OPEN_RATIO;
  const flick = Math.sign(p.velocity) === dir && Math.abs(p.velocity) > OPEN_VELOCITY;
  if (!(far || flick)) return null;
  return dir > 0 ? 'left' : 'right';
}

/**
 * Swipe a list row sideways to uncover an action, like iOS Mail: the row follows
 * the finger, then rests open on the action or springs back. The gesture locks
 * to an axis on its first pixels, so scrolling the list never moves a row.
 * `open` is owned by the caller (one row open at a time); `swiped` tells it a
 * horizontal drag just happened, so the click that follows is not a tap.
 */
export function useRowSwipe(opts: { open: RowSide | null; onOpenChange: (side: RowSide | null) => void }) {
  const { open, onOpenChange } = opts;
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  const last = useRef({ x: 0, t: 0, v: 0 });
  const swiped = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    start.current = { x: t.clientX, y: t.clientY, axis: null };
    last.current = { x: t.clientX, t: e.timeStamp, v: 0 };
    swiped.current = false;
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const mx = t.clientX - s.x;
      const my = t.clientY - s.y;
      if (s.axis === null) {
        if (Math.max(Math.abs(mx), Math.abs(my)) < AXIS_LOCK) return;
        s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        // Scrolling the list closes the open row.
        if (s.axis === 'y' && open) onOpenChange(null);
        if (s.axis === 'x') swiped.current = true;
      }
      if (s.axis !== 'x') return;
      const dt = Math.max(1, e.timeStamp - last.current.t);
      last.current = { x: t.clientX, t: e.timeStamp, v: (t.clientX - last.current.x) / dt };
      setDrag(dragOffset(rowOffset(open) + mx));
    },
    [open, onOpenChange],
  );

  const end = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.axis !== 'x') return;
      const x = e.changedTouches[0]?.clientX ?? last.current.x;
      // A finger that rested before lifting carries no flick.
      const velocity = e.timeStamp - last.current.t > 80 ? 0 : last.current.v;
      setDrag(null);
      onOpenChange(settleRow({ offset: rowOffset(open) + x - s.x, velocity }));
    },
    [open, onOpenChange],
  );

  return {
    offset: drag ?? rowOffset(open),
    dragging: drag !== null,
    /** True right after a horizontal drag: the click that follows is not a tap. */
    swiped,
    touchProps: { onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end },
  };
}
