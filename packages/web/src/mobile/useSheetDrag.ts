import { useCallback, useRef, useState } from 'react';

/** Distance (px) or speed (px/ms) past which a drag down dismisses the sheet. */
export const DISMISS_DISTANCE = 100;
export const DISMISS_VELOCITY = 0.5;

/** Spring-ish easing used by iOS sheets. */
export const SHEET_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const SHEET_MS = 320;

/**
 * Interactive swipe-down-to-dismiss for a bottom sheet, like a native iOS
 * sheet: the panel follows the finger, then either flies out (past a distance
 * or a flick) or springs back. `dy` is the live offset; `dragging` turns the
 * CSS transition off while the finger is down.
 *
 * `getScrollTop` lets a scrollable sheet start the drag only when its content
 * is scrolled to the top (otherwise the gesture is a normal scroll).
 */
export function useSheetDrag(onDismiss: () => void, getScrollTop?: () => number) {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number; armed: boolean } | null>(null);
  const last = useRef({ y: 0, t: 0 });

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      const armed = !getScrollTop || getScrollTop() <= 0;
      start.current = { y, t: e.timeStamp, armed };
      last.current = { y, t: e.timeStamp };
    },
    [getScrollTop],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      if (!s || !s.armed) return;
      const y = e.touches[0]?.clientY ?? 0;
      const delta = y - s.y;
      if (delta <= 0) {
        // Scrolling back up: hand the gesture back to the content.
        if (dragging) setDy(0);
        return;
      }
      if (!dragging) setDragging(true);
      last.current = { y, t: e.timeStamp };
      setDy(delta);
    },
    [dragging],
  );

  const end = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || !dragging) return;
      const y = e.changedTouches[0]?.clientY ?? last.current.y;
      const delta = y - s.y;
      const dt = Math.max(1, e.timeStamp - last.current.t);
      const velocity = (y - last.current.y) / dt;
      setDragging(false);
      if (delta > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) onDismiss();
      setDy(0);
    },
    [dragging, onDismiss],
  );

  return {
    dy,
    dragging,
    touchProps: { onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end },
  };
}
