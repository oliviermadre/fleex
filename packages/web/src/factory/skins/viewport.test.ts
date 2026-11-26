import { describe, expect, it } from 'vitest';
import { FloorScene } from '../scene';
import type { ViewState } from '../renderer';
import type { FactoryLayout, MachineSpec } from '../types';
import { FleexSkin } from './fleex';
import type { Piece, Surface } from './skin';

const ink = (): CanvasRenderingContext2D => new Proxy({}, { get: () => () => undefined, set: () => true }) as CanvasRenderingContext2D;
const station = (id: string, x: number): MachineSpec => ({ id, kind: 'station', x, y: 0, w: 5, h: 4, name: id, exec: 'agent', outcomes: ['ok'], cap: 2 });
const belt = (id: string, x: number): MachineSpec => ({ id, kind: 'belt', x, y: 6, w: 1, h: 1, dir: 0 });
/* a floor far wider than a view: stations and arms every ten tiles */
const machines: MachineSpec[] = [];
for (let k = 0; k < 20; k++) machines.push(station(`s${k}`, k * 10), belt(`b${k}`, k * 10), { id: `a${k}`, kind: 'arm', x: k * 10 + 5, y: 1, w: 1, h: 1, dir: 0 } as MachineSpec);
const layout: FactoryLayout = { version: 2, w: 0, h: 0, machines };
const st: ViewState = { layout, tickets: [], arms: new Map(), selMachine: null, selMany: [], marquee: null, selTicket: null, hoverMachine: null, edit: false, ghost: null, drag: null };

/** A view 800 by 600 that looks from there, that close. */
const view = (x: number, z: number): Surface => {
  const cam = { x, y: 3, z }, w = 800, h = 600;
  return { ctx: ink(), cv: { width: w, height: h } as HTMLCanvasElement, dpr: 1, w, h, cam, toWorld: (sx, sy) => ({ x: (sx - w / 2) / z + cam.x, y: (sy - h / 2) / z + cam.y }), floorOf: () => ({ x: -10, y: -10, w: 300, h: 150 }), machine: () => null };
};
const listed = (on: Surface): number => {
  const skin = new FleexSkin(), S = new FloorScene().build(st, 0), out: Piece[] = [];
  skin.aim(on, S); skin.pieces(S, st, out);
  return out.length;
};

describe('what a flat skin paints of a floor', () => {
  it('is what the view shows, with a little room round it, not the whole floor', () => {
    const whole = listed(view(100, 3)), close = listed(view(100, 40)), elsewhere = listed(view(100, 40));
    /* from far, everything is in view: every station and every arm is listed */
    expect(whole).toBeGreaterThanOrEqual(40);
    /* from close (20 tiles across), two or three stations of the twenty */
    expect(close).toBeLessThan(whole / 3);
    expect(close).toBe(elsewhere);
  });

  it('still paints what stands just beyond the edge: a halo, a plate, an arm reach past their tiles', () => {
    /* the view ends at x = 10 (20 tiles across, from x = -10): the station at x = 10 is just out of it, and still listed */
    const near = listed(view(0, 40)), far = listed(view(-30, 40));
    expect(near).toBeGreaterThan(far);
  });
});
