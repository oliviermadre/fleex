import { afterEach, describe, it, expect, vi } from 'vitest';
import { builtRect, FactoryView, floorRect } from './renderer';
import type { FactoryLayout, MachineSpec } from './types';

const station = (id: string, x: number, y: number): MachineSpec => ({ id, kind: 'station', x, y, w: 5, h: 4, name: id, exec: 'agent', outcomes: ['ok'], cap: 2 });
const layout = (...machines: MachineSpec[]): FactoryLayout => ({ version: 2, w: 0, h: 0, machines });
/** A view of a given size, with no canvas behind it: only where it looks from is asked of it here. */
const view = (w: number, h: number): FactoryView => { const v = new FactoryView({ getContext: () => null, clientWidth: w, clientHeight: h, width: 0, height: 0 } as unknown as HTMLCanvasElement); v.resize(); return v; };
const seen = (v: FactoryView) => { const hw = v.w / 2 / v.cam.z, hh = v.h / 2 / v.cam.z; return { x0: v.cam.x - hw, x1: v.cam.x + hw, y0: v.cam.y - hh, y1: v.cam.y + hh }; };

describe('the floor is the map', () => {
  const built = layout(station('a', 0, 0), station('b', 60, 10));

  it('takes the shape of the view, so that seen whole it fills it', () => {
    const plain = floorRect(built), wide = floorRect(built, 4), tall = floorRect(built, 0.8);
    expect(wide.h).toBe(plain.h);
    expect(wide.w / wide.h).toBeGreaterThanOrEqual(4);
    expect(wide.w / wide.h).toBeLessThan(4 + 1 / wide.h);                   // by less than a tile
    expect(tall.w).toBe(plain.w);
    expect(tall.w / tall.h).toBeLessThanOrEqual(0.8);
    /* it grows around what is built, and its sides stay on whole tiles */
    for (const f of [wide, tall]) {
      expect([f.x, f.y, f.w, f.h].every(Number.isInteger)).toBe(true);
      expect(f.x).toBeLessThanOrEqual(plain.x); expect(f.x + f.w).toBeGreaterThanOrEqual(plain.x + plain.w);
      expect(f.y).toBeLessThanOrEqual(plain.y); expect(f.y + f.h).toBeGreaterThanOrEqual(plain.y + plain.h);
    }
    expect(floorRect(built, NaN)).toEqual(plain);
  });

  it('cannot be zoomed out of: at the farthest the floor covers the view', () => {
    const v = view(1300, 600), F = v.floorOf(built);
    v.cam.z = 0.5;
    v.constrain(built);
    const s = seen(v);
    expect(s.x0).toBeGreaterThanOrEqual(F.x - 1e-9); expect(s.x1).toBeLessThanOrEqual(F.x + F.w + 1e-9);
    expect(s.y0).toBeGreaterThanOrEqual(F.y - 1e-9); expect(s.y1).toBeLessThanOrEqual(F.y + F.h + 1e-9);
    /* and it is the whole floor, to within the tile its sides were rounded to */
    expect(s.x1 - s.x0).toBeGreaterThan(F.w - 1.5);
    /* the wheel stops there too, without drifting */
    const at = { ...v.cam };
    v.zoomAt(100, 100, 0.5);
    v.constrain(built);
    expect(v.cam).toEqual(at);
  });

  it('cannot be left: wherever the view is sent, it stops at the edge of the floor', () => {
    const v = view(1300, 600), F = v.floorOf(built);
    for (const [x, y] of [[-500, -500], [900, 900], [-500, 20], [30, 900]] as const) {
      v.cam.z = 40; v.cam.x = x; v.cam.y = y;
      v.constrain(built);
      const s = seen(v);
      expect(s.x0).toBeGreaterThanOrEqual(F.x - 1e-9); expect(s.x1).toBeLessThanOrEqual(F.x + F.w + 1e-9);
      expect(s.y0).toBeGreaterThanOrEqual(F.y - 1e-9); expect(s.y1).toBeLessThanOrEqual(F.y + F.h + 1e-9);
    }
    /* inside the floor it is left where it is */
    v.cam.z = 40; v.cam.x = 30; v.cam.y = 8;
    v.constrain(built);
    expect([v.cam.x, v.cam.y, v.cam.z]).toEqual([30, 8, 40]);
  });

  it('fits what is built, or the whole floor, without ever showing past it', () => {
    const v = view(1300, 600), F = v.floorOf(built);
    for (const whole of [true, false]) {
      v.fit(built, whole);
      const s = seen(v);
      expect(s.x0).toBeGreaterThanOrEqual(F.x - 1e-9); expect(s.x1).toBeLessThanOrEqual(F.x + F.w + 1e-9);
      expect(s.y0).toBeGreaterThanOrEqual(F.y - 1e-9); expect(s.y1).toBeLessThanOrEqual(F.y + F.h + 1e-9);
    }
    /* an empty floor is a starting floor, and holds the view as well */
    const empty = layout(), w = view(1900, 800);
    w.fit(empty, true);
    expect(seen(w).x1 - seen(w).x0).toBeLessThanOrEqual(w.floorOf(empty).w + 1e-9);
  });
});

describe('the smallest floor', () => {
  const inbound: MachineSpec = { id: 'in', kind: 'zone', x: 148, y: 72, w: 4, h: 6, name: 'Inbound', status: '', release: 'manual', inbound: true };

  it('is 300 tiles wide and 150 high, its Inbound in the middle, so a new factory has room to grow on every side', () => {
    expect(floorRect(layout(inbound))).toEqual({ x: 0, y: 0, w: 300, h: 150 });
    expect(floorRect(layout())).toMatchObject({ w: 300, h: 150 });
    /* what is built past it makes it grow, as before */
    const wide = floorRect(layout(station('a', 0, 0), station('b', 400, 0)));
    expect(wide.w).toBe(405 + 2 * 8);
    expect(wide.h).toBe(150);
  });

  it('is not what a new factory is first seen as: the view frames its Inbound close enough to be read', () => {
    const v = view(1300, 600), l = layout(inbound);
    v.fit(l, false);
    const s = seen(v);
    expect(s.x0).toBeLessThanOrEqual(148); expect(s.x1).toBeGreaterThanOrEqual(152);
    expect(s.y0).toBeLessThanOrEqual(72); expect(s.y1).toBeGreaterThanOrEqual(78);
    expect(s.x1 - s.x0).toBeLessThan(60);                                            // not the 300 tiles of the floor
    /* the whole floor is still there to be built on */
    v.fit(l, true);
    expect(seen(v).x1 - seen(v).x0).toBeGreaterThanOrEqual(299);
  });
});

describe('what the minimap frames', () => {
  it('is what is built, with a tile of room round it, and not the floor\'s margins', () => {
    const l = layout(station('a', 10, 4), station('b', 30, 12));
    expect(builtRect(l)).toEqual({ x: 9, y: 3, w: 27, h: 14 });
    const f = floorRect(l);
    expect(f.w).toBeGreaterThan(27);                                                // the floor itself is wider: it has its margins
    expect(builtRect(layout())).toBeNull();
  });
});

describe('the model under a station', () => {
  afterEach(() => vi.restoreAllMocks());
  /** A canvas that does nothing but remember what was written on it. */
  const drawn = () => {
    const texts: string[] = [];
    const noop = () => {};
    const ctx: Record<string | symbol, unknown> = new Proxy({}, {
      get: (_t, k) => k === 'fillText' ? (s: string) => texts.push(s) : k === 'measureText' ? (s: string) => ({ width: s.length * 6 })
        : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop: noop })
        : k === 'getLineDash' ? () => [] : k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : noop,
      set: () => true,
    });
    /* the floor is painted once on a canvas of its own, made by the view */
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const v = new FactoryView({ getContext: () => ctx, clientWidth: 1200, clientHeight: 800, width: 0, height: 0 } as unknown as HTMLCanvasElement);
    return { v, texts };
  };
  const st = (l: FactoryLayout, modelOf?: (m: Extract<MachineSpec, { kind: 'station' }>) => string | null) => ({
    layout: l, tickets: [], arms: new Map(), selMachine: null, selMany: [], marquee: null, selTicket: null, hoverMachine: null, edit: false, ghost: null, drag: null, modelOf,
  });

  it('is written, without its claude- prefix, under what runs a model, and nowhere else', () => {
    const l = layout(station('a', 148, 72), { ...station('s', 156, 72), exec: 'skill', ref: 'x' } as MachineSpec);
    const { v, texts } = drawn();
    v.fit(l, false);
    v.draw(st(l, (m) => (m.exec === 'agent' ? 'claude-opus-4-8' : null)), 0);
    expect(texts.filter((t) => t === 'opus-4-8')).toHaveLength(1);
  });

  it('is not written when the model is not known yet', () => {
    const l = layout(station('a', 148, 72));
    const { v, texts } = drawn();
    v.fit(l, false);
    v.draw(st(l, () => null), 0);
    expect(texts.some((t) => t.includes('opus') || t.includes('inherit'))).toBe(false);
  });
});
