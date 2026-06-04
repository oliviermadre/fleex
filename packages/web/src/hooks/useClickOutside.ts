import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Closes a popover/dropdown when the user clicks outside of the referenced
 * element(s) or presses Escape.
 *
 * @param refs    A single ref or an array of refs. When several refs are
 *                provided, `handler` only fires if the click is outside of
 *                ALL of them (e.g. a trigger button + its floating menu).
 * @param handler Called on an outside click or an Escape keypress.
 * @param enabled When false, no listeners are attached. Pass the `open` state
 *                so listeners are only active while the popover is open.
 */
export function useClickOutside(
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  handler: () => void,
  enabled = true,
): void {
  // Keep the latest handler in a ref so changing it does not re-attach
  // listeners on every render (the original inline blocks only re-ran on
  // `open` changes).
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const targets = Array.isArray(refs) ? refs : [refs];

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      // A click closes only if it lands outside every referenced element.
      // A null ref (unmounted, e.g. a not-yet-rendered portal) is treated as
      // "outside" so it never blocks closing.
      if (targets.every((r) => !r.current || !r.current.contains(target))) {
        handlerRef.current();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handlerRef.current();
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
    // `refs` holds stable useRef objects; we intentionally only re-run on `enabled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
