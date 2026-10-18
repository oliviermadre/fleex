import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefCallback } from 'react';

/** A callback ref that also exposes the attached element as `.current`. */
export type StickToBottomRef<T extends HTMLElement> = RefCallback<T> & { current: T | null };

/**
 * Stick-to-bottom scroll helper.
 *
 * Rule: when the scrollbar is *already* at the bottom and new content is
 * appended, keep the view pinned to the bottom (follow). When the user has
 * scrolled up, do NOT move the view — they're reading something and a forced
 * scroll-to-bottom would be jarring. Following resumes once the user scrolls
 * back to the bottom themselves, or when `scrollToBottom()` is called.
 *
 * Usage:
 *   const { containerRef, isAtBottom, scrollToBottom, maybeStick } = useStickToBottom();
 *   <div ref={containerRef}>…</div>
 *   // when content changes:
 *   useLayoutEffect(() => { maybeStick(); }, [items.length, maybeStick]);
 *
 * `containerRef` is a callback ref (so listeners attach even when the
 * container mounts *after* the hook, e.g. behind an empty state) that also
 * exposes `.current` like a regular ref object.
 *
 * `maybeStick()` must be called from a `useLayoutEffect` so it runs after the
 * DOM has grown but before paint — that avoids a visible jump/flicker.
 */
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(threshold = 32) {
  const [el, setEl] = useState<T | null>(null);
  const containerRef = useMemo(() => {
    const ref = ((node: T | null) => {
      ref.current = node;
      setEl(node);
    }) as StickToBottomRef<T>;
    ref.current = null;
    return ref;
  }, []);
  // Snapshot of "was the user at the bottom" — updated on every scroll event
  // and on the *start* of an upward gesture, so when content changes we know
  // the user's intent before the DOM grew.
  // Defaults to true so the very first render starts pinned to the bottom.
  const wasAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    const setPinned = (pinned: boolean) => {
      wasAtBottomRef.current = pinned;
      setIsAtBottom(pinned);
    };

    // While a finger is on the screen the user is in control: a scroll event
    // may only unpin, never re-pin (iOS can report a stale "at bottom" between
    // the finger moving and the view actually moving).
    let touchActive = false;
    let lastTouchY = 0;

    const onScroll = () => {
      const atBottom = measure();
      if (atBottom && touchActive) return;
      setPinned(atBottom);
    };
    // Unpin on the *start* of an upward gesture, before the browser emits the
    // scroll event, so a chunk landing in between cannot yank the view back.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) setPinned(false);
    };
    const onTouchStart = (e: TouchEvent) => {
      touchActive = true;
      lastTouchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? lastTouchY;
      // Finger moving down = content scrolling up.
      if (y > lastTouchY) setPinned(false);
      lastTouchY = y;
    };
    const onTouchEnd = () => {
      touchActive = false;
      // Momentum (if any) keeps emitting scroll events; this covers a gesture
      // that ended back at the bottom without a further scroll event.
      if (measure()) setPinned(true);
    };
    // Grabbing the scrollbar: clicks past the content box land on it.
    const onPointerDown = (e: PointerEvent) => {
      const x = e.clientX - el.getBoundingClientRect().left;
      if (e.target !== el || !(x >= el.clientWidth)) return;
      setPinned(false);
      document.addEventListener(
        'pointerup',
        () => {
          if (measure()) setPinned(true);
        },
        { once: true },
      );
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('pointerdown', onPointerDown);
    };
  }, [el, threshold]);

  /** Force the view to the bottom (e.g. the user just posted). */
  const scrollToBottom = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    wasAtBottomRef.current = true;
    setIsAtBottom(true);
  }, [containerRef]);

  /** Stick to bottom only if the user was at the bottom before the content grew. */
  const maybeStick = useCallback(() => {
    if (!wasAtBottomRef.current) return;
    const node = containerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [containerRef]);

  return { containerRef, isAtBottom, scrollToBottom, maybeStick };
}
