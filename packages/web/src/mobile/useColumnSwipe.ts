import { useCallback, useRef, useState } from 'react';

/** Share of a page (or speed, px/ms) past which a drag lands on the next column. */
const SNAP_RATIO = 1 / 3;
const SNAP_VELOCITY = 0.4;
/** Movement (px) before the gesture commits to an axis. */
const AXIS_LOCK = 8;
/** How much of the drag is kept past the first/last column. */
const EDGE_RESISTANCE = 0.3;

export const COLUMN_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const COLUMN_MS = 300;

/** Column the track settles on when the finger lifts: at most one step per gesture. */
export function snapColumn(p: { idx: number; count: number; dx: number; velocity: number; pageWidth: number }): number {
  const dir = Math.sign(p.dx);
  const far = Math.abs(p.dx) > p.pageWidth * SNAP_RATIO;
  const flick = Math.abs(p.velocity) > SNAP_VELOCITY && Math.sign(p.velocity) === dir;
  if (dir === 0 || !(far || flick)) return p.idx;
  return Math.max(0, Math.min(p.count - 1, p.idx - dir));
}

/** Live offset: 1:1 inside the board, damped past either end. */
export function rubberBand(dx: number, idx: number, count: number): number {
  const pastStart = idx === 0 && dx > 0;
  const pastEnd = idx === count - 1 && dx < 0;
  return pastStart || pastEnd ? dx * EDGE_RESISTANCE : dx;
}

/**
 * Horizontal paging between kanban columns that follows the finger. The
 * gesture locks to an axis on its first few pixels, so scrolling a column
 * vertically never pages it. `dx` is the live offset; `dragging` turns the
 * CSS transition off while the finger is down.
 */
export function useColumnSwipe(opts: { idx: number; count: number; pageWidth: number; onChange: (idx: number) => void }) {
  const { idx, count, pageWidth, onChange } = opts;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  const last = useRef({ x: 0, t: 0, v: 0 });

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    start.current = { x: t.clientX, y: t.clientY, axis: null };
    last.current = { x: t.clientX, t: e.timeStamp, v: 0 };
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
        if (s.axis === 'x') setDragging(true);
      }
      if (s.axis !== 'x') return;
      const dt = Math.max(1, e.timeStamp - last.current.t);
      last.current = { x: t.clientX, t: e.timeStamp, v: (t.clientX - last.current.x) / dt };
      setDx(rubberBand(mx, idx, count));
    },
    [idx, count],
  );

  const end = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.axis !== 'x') return;
      const x = e.changedTouches[0]?.clientX ?? last.current.x;
      // A finger that rested before lifting carries no flick.
      const velocity = e.timeStamp - last.current.t > 80 ? 0 : last.current.v;
      setDragging(false);
      setDx(0);
      onChange(snapColumn({ idx, count, dx: x - s.x, velocity, pageWidth }));
    },
    [idx, count, pageWidth, onChange],
  );

  return {
    dx,
    dragging,
    touchProps: { onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end },
  };
}
