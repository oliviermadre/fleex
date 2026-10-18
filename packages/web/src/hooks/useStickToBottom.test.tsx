import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { useStickToBottom } from './useStickToBottom';

type Api = ReturnType<typeof useStickToBottom<HTMLDivElement>>;

/**
 * Mirrors how the assistant screens use the hook: the scroll container only
 * exists once `ready` (the companion is connected), and `maybeStick()` runs in
 * a layout effect each time the content (`items`) changes.
 */
function Harness({ ready, items, apiRef }: { ready: boolean; items: number; apiRef: { current: Api | null } }) {
  const api = useStickToBottom<HTMLDivElement>();
  apiRef.current = api;
  const { maybeStick } = api;
  useLayoutEffect(() => {
    maybeStick();
  }, [items, maybeStick]);
  if (!ready) return <p>Companion injoignable</p>;
  return <div data-testid="scroller" ref={api.containerRef} />;
}

/** jsdom has no layout: give the scroller a fixed geometry we control. */
function setGeometry(el: HTMLElement, scrollHeight: number, clientHeight = 500) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 300 });
}

/** The user scrolled to `top` (a real scroll also emits a `scroll` event). */
function userScrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

/** jsdom has no PointerEvent: a MouseEvent carries the coordinates we need. */
function pointerDown(el: HTMLElement, clientX: number) {
  fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientX }));
}

/** Mount behind an empty state, then show the conversation — the real-world order. */
function mountLate() {
  const apiRef: { current: Api | null } = { current: null };
  const view = render(<Harness ready={false} items={0} apiRef={apiRef} />);
  view.rerender(<Harness ready items={1} apiRef={apiRef} />);
  const el = view.getByTestId('scroller');
  setGeometry(el, 1000);
  userScrollTo(el, 500); // at the bottom: 1000 - 500 - 500 = 0
  const stream = (items: number, scrollHeight: number) => {
    setGeometry(el, scrollHeight);
    view.rerender(<Harness ready items={items} apiRef={apiRef} />);
  };
  return { el, apiRef, stream };
}

afterEach(() => cleanup());

describe('useStickToBottom', () => {
  it('follows streamed content while the user stays at the bottom', () => {
    const { el, stream } = mountLate();
    stream(2, 1200);
    expect(el.scrollTop).toBe(1200);
  });

  // The bug: the container appeared after the hook mounted, the scroll
  // listener was never attached, and every streamed chunk yanked the view down.
  it('stops following once the user scrolls up, even when the container mounted late', () => {
    const { el, stream } = mountLate();
    userScrollTo(el, 300);
    stream(2, 1200);
    expect(el.scrollTop).toBe(300);
  });

  // iOS / trackpad race: a chunk can land between the gesture and the scroll event.
  it('stops following on an upward wheel before any scroll event fires', () => {
    const { el, stream } = mountLate();
    fireEvent.wheel(el, { deltaY: -40 });
    stream(2, 1200);
    expect(el.scrollTop).toBe(500);
  });

  it('stops following as soon as the finger drags the content up', () => {
    const { el, stream } = mountLate();
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 140 }] });
    stream(2, 1200);
    expect(el.scrollTop).toBe(500);
  });

  it('does not let a stale "at bottom" scroll event re-pin while the finger is down', () => {
    const { el, stream } = mountLate();
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 140 }] });
    fireEvent.scroll(el); // geometry still says "at bottom"
    stream(2, 1200);
    expect(el.scrollTop).toBe(500);
  });

  it('keeps following when a touch at the bottom does not scroll up', () => {
    const { el, stream } = mountLate();
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(el);
    stream(2, 1200);
    expect(el.scrollTop).toBe(1200);
  });

  it('stops following when the user grabs the scrollbar', () => {
    const { el, stream } = mountLate();
    pointerDown(el, 310);
    stream(2, 1200);
    expect(el.scrollTop).toBe(500);
  });

  it('keeps following when the user clicks inside the content (selecting, tapping a link)', () => {
    const { el, stream } = mountLate();
    pointerDown(el, 120);
    stream(2, 1200);
    expect(el.scrollTop).toBe(1200);
  });

  it('resumes following when the user scrolls back to the bottom', () => {
    const { el, stream } = mountLate();
    userScrollTo(el, 300);
    stream(2, 1200);
    userScrollTo(el, 700); // 1200 - 700 - 500 = 0
    stream(3, 1500);
    expect(el.scrollTop).toBe(1500);
  });

  it('scrollToBottom() jumps to the bottom and resumes following (the user just sent a message)', () => {
    const { el, apiRef, stream } = mountLate();
    userScrollTo(el, 100);
    act(() => apiRef.current!.scrollToBottom());
    expect(el.scrollTop).toBe(1000);
    stream(2, 1300);
    expect(el.scrollTop).toBe(1300);
  });

  // Our own scroll-to-bottom emits a scroll event too: it must not read as "the user left".
  it('does not mistake its own stick-to-bottom scroll for the user scrolling', () => {
    const { el, stream } = mountLate();
    stream(2, 1200);
    fireEvent.scroll(el);
    stream(3, 1400);
    expect(el.scrollTop).toBe(1400);
  });

  // TicketComments reads `listContainerRef.current` (IntersectionObserver root).
  it('exposes the mounted element on containerRef.current', () => {
    const { el, apiRef } = mountLate();
    expect(apiRef.current!.containerRef.current).toBe(el);
  });
});
