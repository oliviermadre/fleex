import { useEffect, useRef } from 'react';

/** Empty agenda surfaces that create an event on click / drag (time-grid columns, all-day and month cells). */
const CREATE_SURFACE = '[data-agenda-col], [data-agenda-day]';
/** Anything the user can act on inside those surfaces (chips, "+N", day numbers…). */
const INTERACTIVE = 'button, a, input, textarea, select, [role="button"]';

/**
 * While a popover is open, the first press on an empty agenda slot only closes
 * it — like Google Calendar. Without this, the outside press both dismissed the
 * popover and went on to open the "new event" editor.
 *
 * Presses on another chip are left alone: they close the popover and open the
 * other item, as before.
 */
export function useDismissBeforeCreate(open: boolean, close: () => void, floating: () => HTMLElement | null) {
  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(close);
  closeRef.current = close;
  const floatingRef = useRef(floating);
  floatingRef.current = floating;

  useEffect(() => {
    let swallowClick = false;
    const onPointerDown = (e: PointerEvent) => {
      swallowClick = false;
      if (!openRef.current) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (floatingRef.current()?.contains(t)) return;
      if (!t.closest(CREATE_SURFACE) || t.closest(INTERACTIVE)) return;
      // Stop here: no drag-to-create starts, no other dismiss handler runs.
      e.stopPropagation();
      e.preventDefault();
      swallowClick = true;
      closeRef.current();
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    // The click (if any) fires right after pointerup; past that, forget it so a
    // later, unrelated click is never eaten.
    const onPointerUp = () => { if (swallowClick) setTimeout(() => { swallowClick = false; }, 0); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);
}
