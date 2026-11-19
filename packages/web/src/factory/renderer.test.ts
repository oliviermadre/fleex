import { describe, it, expect } from 'vitest';
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

describe('what the minimap frames', () => {
  it('is what is built, with a tile of room round it, and not the floor\'s margins', () => {
    const l = layout(station('a', 10, 4), station('b', 30, 12));
    expect(builtRect(l)).toEqual({ x: 9, y: 3, w: 27, h: 15 });
    const f = floorRect(l);
    expect(f.w).toBeGreaterThan(27);                                                // the floor itself is wider: it has its margins
    expect(builtRect(layout())).toBeNull();
  });
});
