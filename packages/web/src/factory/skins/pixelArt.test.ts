import { describe, expect, it } from 'vitest';
import { ART, disc, figures, frame, poly, ring, seg, sprite } from './pixelArt';

/** A canvas that keeps the pixels of art filled, by colour. */
function fake() {
  const lit = new Map<string, string>(), rects: number[][] = [];
  const ctx = {
    fillStyle: '',
    beginPath() { rects.length = 0; },
    rect(x: number, y: number, w: number, h: number) { rects.push([x, y, w, h]); },
    fill() {
      for (const [x, y, w, h] of rects) for (let i = Math.round(x! * ART); i < Math.round((x! + w!) * ART); i++) for (let j = Math.round(y! * ART); j < Math.round((y! + h!) * ART); j++) lit.set(`${i},${j}`, ctx.fillStyle);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, lit, at: (i: number, j: number) => lit.get(`${i},${j}`) };
}

describe('pixel art', () => {
  it('fills whole pixels only, symmetric round a point between pixels', () => {
    const { ctx, lit } = fake();
    disc(ctx, 8, 8, 4.2, 'a');
    expect(lit.size).toBeGreaterThan(40);
    for (const k of lit.keys()) { const [i, j] = k.split(',').map(Number); expect(lit.has(`${15 - i!},${j}`)).toBe(true); expect(lit.has(`${i},${15 - j!}`)).toBe(true); }
  });

  it('draws below zero as above it: the floor has negative tiles', () => {
    const here = fake(), there = fake();
    disc(here.ctx, 8, 8, 4.2, 'a');
    disc(there.ctx, -600, -392, 4.2, 'a');
    expect(there.lit.size).toBe(here.lit.size);
    expect(there.at(-600, -392)).toBe('a');
    const line = fake();
    seg(line.ctx, -40, -8, -24, -8, 2, 's');
    expect(line.at(-30, -9)).toBe('s');
  });

  it('leaves the middle of a ring empty, and a dashed ring only where kept', () => {
    const { ctx, at, lit } = fake();
    ring(ctx, 8, 8, 4.6, 1, 'r');
    expect(at(7, 7)).toBeUndefined();
    expect(at(12, 8)).toBe('r');
    const all = lit.size;
    const half = fake();
    ring(half.ctx, 8, 8, 4.6, 1, 'r', (a) => a > 0);
    expect(half.lit.size).toBeLessThan(all);
  });

  it('draws a stroke as thick as asked along an axis', () => {
    const { ctx, at } = fake();
    seg(ctx, 0, 8, 16, 8, 4, 's');
    expect([6, 7, 8, 9].map((j) => at(5, j))).toEqual(['s', 's', 's', 's']);
    expect(at(5, 5)).toBeUndefined();
    expect(at(5, 10)).toBeUndefined();
  });

  it('outlines a polygon in its own colour', () => {
    const { ctx, at } = fake();
    poly(ctx, [[0, 0], [10, 0], [10, 10], [0, 10]], 'in', 'edge');
    expect(at(0, 5)).toBe('edge');
    expect(at(5, 5)).toBe('in');
  });

  it('dashes a frame and cuts its corners', () => {
    const { ctx, at } = fake();
    frame(ctx, 0, 0, 20, 10, 1, 'f', [3, 2], 2);
    expect(at(0, 0)).toBeUndefined();
    expect(at(2, 0)).toBe('f');
    expect(at(4, 0)).toBe('f');
    expect(at(5, 0)).toBeUndefined();
    expect(at(7, 0)).toBe('f');
  });

  it('turns a sprite a quarter at a time', () => {
    const east = fake(), south = fake();
    sprite(east.ctx, ['X..', '.X.'], 0, 0, { X: 'c' });
    sprite(south.ctx, ['X..', '.X.'], 0, 0, { X: 'c' }, 1);
    expect([...east.lit.keys()].sort()).toEqual(['0,0', '1,1']);
    expect([...south.lit.keys()].sort()).toEqual(['0,1', '1,0']);
  });

  it('writes figures three pixels by five, scaled', () => {
    const { ctx, lit } = fake();
    figures(ctx, '1', 0, 0, 2, 'n');
    expect(lit.size).toBe(8 * 4);
  });
});
