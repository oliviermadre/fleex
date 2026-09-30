/**
 * Drag-to-resize for the Work view's bottom drawers (Shell, Timeline). The
 * drawer's bottom edge sits just above the 26px status bar, so its height is
 * the distance from the pointer up from there; the store clamps and persists it.
 */
import { useCallback, useEffect, useRef } from 'react';

/** WorkStatusBar height (SPEC §10) — the drawers' bottom edge sits above it. */
export const STATUS_BAR_H = 26;

/** Returns the top-edge handle's onMouseDown. */
export function useBottomDrawerResize(setHeight: (height: number) => void): () => void {
  const dragging = useRef(false);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      setHeight(window.innerHeight - STATUS_BAR_H - e.clientY);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setHeight]);

  return onMouseDown;
}
