import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Stick-to-bottom scroll helper.
 *
 * Rule: when the scrollbar is *already* at the bottom and new content is
 * appended, keep the view pinned to the bottom (follow). When the user has
 * scrolled up, do NOT move the view — they're reading something and a forced
 * scroll-to-bottom would be jarring.
 *
 * Usage:
 *   const { containerRef, isAtBottom, scrollToBottom, maybeStick } = useStickToBottom();
 *   <div ref={containerRef}>…</div>
 *   // when content changes:
 *   useLayoutEffect(() => { maybeStick(); }, [items.length, maybeStick]);
 *
 * `maybeStick()` must be called from a `useLayoutEffect` so it runs after the
 * DOM has grown but before paint — that avoids a visible jump/flicker.
 */
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(threshold = 32) {
  const containerRef = useRef<T>(null);
  // Snapshot of "was the user at the bottom" — updated on every scroll event,
  // so when content changes we know the position *before* the DOM grew.
  // Defaults to true so the very first render starts pinned to the bottom.
  const wasAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
      wasAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [threshold]);

  /** Force the view to the bottom (e.g. the user just posted). */
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    wasAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  /** Stick to bottom only if the user was at the bottom before the content grew. */
  const maybeStick = useCallback(() => {
    if (!wasAtBottomRef.current) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return { containerRef, isAtBottom, scrollToBottom, maybeStick };
}
