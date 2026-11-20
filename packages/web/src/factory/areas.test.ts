import { describe, expect, it } from 'vitest';
import { areaAt, fits, freshArea, handleAt, moved, resize, spanOf } from './areas';
import type { AreaSpec } from './types';

const area = (id: string, x: number, y: number, w: number, h: number): AreaSpec => ({ id, kind: 'area', x, y, w, h, name: id, color: '#60a5fa' });

describe('an area, in build mode', () => {
  it('is drawn from one tile to another, both included, whichever way the mouse goes', () => {
    expect(spanOf(2.3, 4.8, 6.1, 5.2)).toEqual({ x: 2, y: 4, w: 5, h: 2 });
    expect(spanOf(6.1, 5.2, 2.3, 4.8)).toEqual({ x: 2, y: 4, w: 5, h: 2 });
    expect(spanOf(3.5, 3.5, 3.5, 3.5)).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });

  it('is taken by a corner before a side, and only near its edge', () => {
    const a = area('a', 2, 2, 6, 4);
    expect(handleAt(a, 2.1, 2.1, 0.25)).toBe('nw');
    expect(handleAt(a, 8, 6.1, 0.25)).toBe('se');
    expect(handleAt(a, 5, 1.9, 0.25)).toBe('n');
    expect(handleAt(a, 7.9, 4, 0.25)).toBe('e');
    expect(handleAt(a, 5, 4, 0.25)).toBeNull();                                          // inside
    expect(handleAt(a, 12, 4, 0.25)).toBeNull();                                         // far away
  });

  it('is resized on whole tiles, its opposite side staying put, never under a tile', () => {
    const a = area('a', 2, 2, 6, 4);
    expect(resize(a, 'e', 10.4, 0)).toEqual({ x: 2, y: 2, w: 8, h: 4 });
    expect(resize(a, 'nw', 0.6, 3.2)).toEqual({ x: 1, y: 3, w: 7, h: 3 });
    expect(resize(a, 'w', 30, 0)).toEqual({ x: 7, y: 2, w: 1, h: 4 });                    // dragged past its other side
    expect(resize(a, 's', 0, -5)).toEqual({ x: 2, y: 2, w: 6, h: 1 });
    expect(moved(a, 1.6, -0.4)).toEqual({ x: 4, y: 2, w: 6, h: 4 });
  });

  it('may be where the overlap rule lets it', () => {
    const big = area('big', 0, 0, 10, 10), r = { x: 2, y: 2, w: 3, h: 3 }, across = { x: 8, y: 8, w: 4, h: 4 }, apart = { x: 20, y: 0, w: 2, h: 2 };
    expect(fits(apart, [big], 'never')).toBe(true);
    expect(fits(r, [big], 'never')).toBe(false);
    expect(fits(r, [big], 'nest')).toBe(true);                                           // wholly inside
    expect(fits({ x: -1, y: -1, w: 12, h: 12 }, [big], 'nest')).toBe(true);              // wholly round it
    expect(fits(across, [big], 'nest')).toBe(false);                                     // across its edge
    expect(fits(across, [big], 'free')).toBe(true);
  });

  it('answers for the smallest of those that hold a point: the innermost', () => {
    const big = area('big', 0, 0, 10, 10), small = area('small', 2, 2, 3, 3);
    expect(areaAt([big, small], 3, 3)?.id).toBe('small');
    expect(areaAt([small, big], 3, 3)?.id).toBe('small');
    expect(areaAt([big, small], 8, 8)?.id).toBe('big');
    expect(areaAt([big, small], 12, 8)).toBeNull();
  });

  it('is born with the next name and a colour no other area has', () => {
    const a = freshArea([], { x: 0, y: 0, w: 2, h: 2 }, 'n1'), b = freshArea([a], { x: 3, y: 0, w: 2, h: 2 }, 'n2');
    expect([a.name, b.name]).toEqual(['Area 1', 'Area 2']);
    expect(a.color).not.toBe(b.color);
    expect(a.kind).toBe('area');
  });
});
