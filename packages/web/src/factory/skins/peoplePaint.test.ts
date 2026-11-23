import { describe, expect, it } from 'vitest';
import { flatWorker, pick } from './peoplePaint';
import type { Palette } from './fleex';

/** A canvas that only records the colours it is given. */
function canvas() {
  const colours: unknown[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : () => {}),
    set: (o, k, v) => { if (k === 'fillStyle' || k === 'strokeStyle') colours.push(v); o[k as string] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, colours };
}
const pal = { floor: '#ffffff', light: true, text: '#18181b' } as Palette;

describe('the people of the floor', () => {
  it('picks a colour whatever the number, negative or not a number', () => {
    expect(pick(['a', 'b', 'c', 'd'], 6)).toBe('c');
    expect(pick(['a', 'b', 'c', 'd'], -3)).toBe('b');
    expect(pick(['a', 'b', 'c', 'd'], Number.NaN)).toBe('a');
  });

  it('draws the worker of a station left of or above the floor\'s origin (its number is negative)', () => {
    const { ctx, colours } = canvas();
    for (const state of ['work', 'wait', 'sleep', 'call', 'ask'] as const) expect(() => flatWorker(ctx, -4.45, -2.4, state, 1.2, pal, false, -4 * 31 - 3, 1)).not.toThrow();
    expect(colours.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });
});
