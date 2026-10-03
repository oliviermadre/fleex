import { useCallback, useRef, useState } from 'react';
import { AXIS_LOCK, rubberBand, snapColumn } from './useColumnSwipe';
import { DISMISS_DISTANCE, DISMISS_VELOCITY } from './useSheetDrag';

export type SheetGesture = 'page' | 'dismiss' | null;

/**
 * What a drag means once it has locked to an axis: sideways pages to the
 * neighbouring sheet, down dismisses — each only where the content under the
 * finger does not need that gesture for itself.
 */
export function pickGesture(p: { mx: number; my: number; canPage: boolean; canDismiss: boolean }): SheetGesture {
  if (Math.abs(p.mx) > Math.abs(p.my)) return p.canPage ? 'page' : null;
  return p.my > 0 && p.canDismiss ? 'dismiss' : null;
}

/** Page step on release (-1, 0 or 1), with the column rules: a third of the width, or a flick. */
export function pageStep(p: { dx: number; velocity: number; pageWidth: number; hasPrev: boolean; hasNext: boolean }): -1 | 0 | 1 {
  const idx = p.hasPrev ? 1 : 0;
  const count = idx + 1 + (p.hasNext ? 1 : 0);
  return (snapColumn({ idx, count, dx: p.dx, velocity: p.velocity, pageWidth: p.pageWidth }) - idx) as -1 | 0 | 1;
}

function isField(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/**
 * What the content under the finger allows: no paging from a text field (text
 * selection) or a block that scrolls sideways (code), no dismiss from a scrolled
 * list unless it sits at its top.
 */
function allowed(target: EventTarget | null, root: HTMLElement | null): { canPage: boolean; canDismiss: boolean } {
  let canPage = true;
  let canDismiss = true;
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (isField(el)) canPage = false;
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth) canPage = false;
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight && el.scrollTop > 0) canDismiss = false;
  }
  return { canPage, canDismiss };
}

/**
 * The full-screen sheet's two gestures, decided on the first pixels: sideways
 * moves to the previous/next sheet (the pages follow the finger, damped at
 * either end), down drags the sheet out. `dx`/`dy` are the live offsets;
 * `dragging` turns the CSS transitions off while the finger is down.
 */
export function useSheetPager(opts: {
  rootRef: React.RefObject<HTMLElement | null>;
  hasPrev: boolean;
  hasNext: boolean;
  onPage: (step: -1 | 1) => void;
  onDismiss: () => void;
}) {
  const { rootRef, hasPrev, hasNext, onPage, onDismiss } = opts;
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; gesture: SheetGesture | 'pending'; canPage: boolean; canDismiss: boolean } | null>(null);
  const last = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0 });

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      // A layer portalled out of the sheet (a picker on body) still bubbles here through React: not ours.
      if (!t || !rootRef.current?.contains(e.target as Node)) {
        start.current = null;
        return;
      }
      start.current = { x: t.clientX, y: t.clientY, gesture: 'pending', ...allowed(e.target, rootRef.current) };
      last.current = { x: t.clientX, y: t.clientY, t: e.timeStamp, vx: 0, vy: 0 };
    },
    [rootRef],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const mx = t.clientX - s.x;
      const my = t.clientY - s.y;
      if (s.gesture === 'pending') {
        if (Math.max(Math.abs(mx), Math.abs(my)) < AXIS_LOCK) return;
        s.gesture = pickGesture({ mx, my, canPage: s.canPage, canDismiss: s.canDismiss });
        if (s.gesture) setDragging(true);
      }
      if (!s.gesture) return;
      const dt = Math.max(1, e.timeStamp - last.current.t);
      last.current = {
        x: t.clientX,
        y: t.clientY,
        t: e.timeStamp,
        vx: (t.clientX - last.current.x) / dt,
        vy: (t.clientY - last.current.y) / dt,
      };
      if (s.gesture === 'page') {
        const idx = hasPrev ? 1 : 0;
        setDx(rubberBand(mx, idx, idx + 1 + (hasNext ? 1 : 0)));
      } else {
        setDy(Math.max(0, my));
      }
    },
    [hasPrev, hasNext],
  );

  const end = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || !s.gesture || s.gesture === 'pending') return;
      const t = e.changedTouches[0];
      // A finger that rested before lifting carries no flick.
      const rested = e.timeStamp - last.current.t > 80;
      setDragging(false);
      setDx(0);
      setDy(0);
      if (s.gesture === 'page') {
        const x = t?.clientX ?? last.current.x;
        const pageWidth = rootRef.current?.clientWidth ?? window.innerWidth;
        const step = pageStep({ dx: x - s.x, velocity: rested ? 0 : last.current.vx, pageWidth, hasPrev, hasNext });
        if (step) onPage(step);
      } else {
        const y = t?.clientY ?? last.current.y;
        if (y - s.y > DISMISS_DISTANCE || (!rested && last.current.vy > DISMISS_VELOCITY)) onDismiss();
      }
    },
    [rootRef, hasPrev, hasNext, onPage, onDismiss],
  );

  return {
    dx,
    dy,
    dragging,
    touchProps: { onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end },
  };
}
