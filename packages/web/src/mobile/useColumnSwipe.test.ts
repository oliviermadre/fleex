import { describe, it, expect } from 'vitest';
import { snapColumn, rubberBand } from './useColumnSwipe';

const base = { idx: 2, count: 6, pageWidth: 300 };

describe('snapColumn', () => {
  it('stays on the column for a short, slow drag', () => {
    expect(snapColumn({ ...base, dx: -40, velocity: -0.1 })).toBe(2);
    expect(snapColumn({ ...base, dx: 40, velocity: 0.1 })).toBe(2);
  });

  it('moves one column once dragged past a third of the page', () => {
    expect(snapColumn({ ...base, dx: -110, velocity: 0 })).toBe(3);
    expect(snapColumn({ ...base, dx: 110, velocity: 0 })).toBe(1);
  });

  it('moves one column on a flick, even when short', () => {
    expect(snapColumn({ ...base, dx: -20, velocity: -0.6 })).toBe(3);
    expect(snapColumn({ ...base, dx: 20, velocity: 0.6 })).toBe(1);
  });

  it('ignores a flick that goes against the drag direction', () => {
    expect(snapColumn({ ...base, dx: -20, velocity: 0.6 })).toBe(2);
  });

  it('moves at most one column per gesture', () => {
    expect(snapColumn({ ...base, dx: -900, velocity: -3 })).toBe(3);
  });

  it('stays within bounds', () => {
    expect(snapColumn({ ...base, idx: 0, dx: 200, velocity: 1 })).toBe(0);
    expect(snapColumn({ ...base, idx: 5, dx: -200, velocity: -1 })).toBe(5);
  });
});

describe('rubberBand', () => {
  it('passes the drag through inside the board', () => {
    expect(rubberBand(-80, 2, 6)).toBe(-80);
  });

  it('resists past the first and last column', () => {
    expect(Math.abs(rubberBand(100, 0, 6))).toBeLessThan(50);
    expect(Math.abs(rubberBand(-100, 5, 6))).toBeLessThan(50);
    expect(rubberBand(-100, 0, 6)).toBe(-100);
  });
});
