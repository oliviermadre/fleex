import { describe, it, expect } from 'vitest';
import { ROW_ACTION_WIDTH as W, dragOffset, rowOffset, settleRow } from './useRowSwipe';

describe('rowOffset', () => {
  it('rests on the side that is open', () => {
    expect(rowOffset(null)).toBe(0);
    expect(rowOffset('left')).toBe(W);
    expect(rowOffset('right')).toBe(-W);
  });
});

describe('dragOffset', () => {
  it('follows the finger up to the action width', () => {
    expect(dragOffset(40)).toBe(40);
    expect(dragOffset(-W)).toBe(-W);
  });

  it('damps the drag past the action', () => {
    expect(dragOffset(W + 100)).toBeLessThan(W + 100);
    expect(dragOffset(W + 100)).toBeGreaterThan(W);
    expect(dragOffset(-(W + 100))).toBe(-dragOffset(W + 100));
  });
});

describe('settleRow', () => {
  it('springs back for a short, slow drag', () => {
    expect(settleRow({ offset: 20, velocity: 0 })).toBeNull();
    expect(settleRow({ offset: -20, velocity: 0 })).toBeNull();
  });

  it('opens on the side the drag uncovered', () => {
    // Dragging right uncovers the left action, dragging left the right one.
    expect(settleRow({ offset: 60, velocity: 0 })).toBe('left');
    expect(settleRow({ offset: -60, velocity: 0 })).toBe('right');
  });

  it('opens on a flick, even when short', () => {
    expect(settleRow({ offset: -15, velocity: -0.6 })).toBe('right');
  });

  it('closes an open row flicked back toward the centre', () => {
    expect(settleRow({ offset: W - 20, velocity: -0.6 })).toBeNull();
  });
});
