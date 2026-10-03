import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { bubblePlacement, PickConfirmation, BUBBLE_W, BUBBLE_H } from './PickConfirmation';

afterEach(cleanup);

const panel = { w: 1000, h: 700 };

describe('bubblePlacement', () => {
  it('puts the bubble under the element, centered on it, and scales by zoom', () => {
    const p = bubblePlacement({ x: 100, y: 50, w: 200, h: 40 }, 1.5, panel);
    expect(p.highlight).toEqual({ left: 150, top: 75, width: 300, height: 60 });
    expect(p.bubble).toEqual({ left: 150 + 150 - BUBBLE_W / 2, top: 75 + 60 + 8 });
  });

  it('flips above the element near the bottom edge', () => {
    const p = bubblePlacement({ x: 400, y: 640, w: 100, h: 40 }, 1, panel);
    expect(p.bubble.top).toBe(640 - 8 - BUBBLE_H);
  });

  it('stays inside the panel sideways and vertically', () => {
    expect(bubblePlacement({ x: 0, y: 10, w: 20, h: 20 }, 1, panel).bubble.left).toBe(8);
    expect(bubblePlacement({ x: 990, y: 10, w: 10, h: 20 }, 1, panel).bubble.left).toBe(1000 - BUBBLE_W - 8);
    // An element as tall as the panel: neither under nor above fits.
    const tall = bubblePlacement({ x: 10, y: 0, w: 100, h: 700 }, 1, panel).bubble.top;
    expect(tall).toBeGreaterThanOrEqual(8);
    expect(tall).toBeLessThanOrEqual(700 - BUBBLE_H - 8);
  });
});

describe('PickConfirmation', () => {
  const pick = {
    key: 1,
    name: '<Card />',
    screenshotUrl: '/api/files/x.png',
    placement: bubblePlacement({ x: 10, y: 10, w: 50, h: 20 }, 1, panel),
  };

  it('shows the element name and a Show action', () => {
    const onShow = vi.fn();
    render(<PickConfirmation pick={pick} onShow={onShow} onDone={vi.fn()} />);
    expect(screen.getByText('<Card />')).toBeTruthy();
    expect(screen.getByText('added to your comment')).toBeTruthy();
    fireEvent.click(screen.getByText('Show'));
    expect(onShow).toHaveBeenCalled();
  });

  it('dismisses itself after a while, but not while hovered', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<PickConfirmation pick={pick} onShow={vi.fn()} onDone={onDone} />);
    const bubble = screen.getByRole('status');
    fireEvent.mouseEnter(bubble);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.mouseLeave(bubble);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onDone).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
