import { describe, expect, it } from 'vitest';
import { FactoryView, type ViewState } from '../renderer';
import type { FactoryLayout, MachineSpec } from '../types';
import { LIFT, PLATFORM, PixelTqSkin } from './pixelTq';

const station: MachineSpec = { id: 's', kind: 'station', x: 4, y: 4, w: 5, h: 4, name: 'Build', exec: 'agent', outcomes: ['ok'], cap: 2 };
const belt: MachineSpec = { id: 'b', kind: 'belt', x: 2, y: 5, w: 1, h: 1, dir: 0 };
const arm: MachineSpec = { id: 'a', kind: 'arm', x: 3, y: 5, w: 1, h: 1, dir: 0 };
const zone: MachineSpec = { id: 'z', kind: 'zone', x: 4, y: 12, w: 3, h: 2, name: 'Ready', release: 'manual' };
const behind: MachineSpec = { id: 'k', kind: 'belt', x: 6, y: 3, w: 1, h: 1, dir: 0 };
const layout: FactoryLayout = { version: 2, w: 0, h: 0, machines: [station, belt, arm, zone, behind] };
const state = (more: Partial<ViewState> = {}): ViewState => ({ layout, tickets: [], arms: new Map(), selMachine: null, selMany: [], marquee: null, selTicket: null, hoverMachine: null, edit: false, ghost: null, drag: null, ...more });

describe('the pixel-3d skin', () => {
  it('stands each kind at its height, and an arm over what it takes from and drops on', () => {
    const s = new PixelTqSkin(), st = state();
    expect(s.liftOf(station, st)).toBe(LIFT.station);
    expect(s.liftOf(belt, st)).toBe(LIFT.belt);
    expect(s.liftOf(zone, st)).toBe(0);
    expect(s.liftOf(arm, st)).toBeGreaterThan(LIFT.station!);
  });

  it('goes flat in build mode', () => {
    const s = new PixelTqSkin(), st = state({ edit: true });
    for (const m of layout.machines) expect(s.liftOf(m, st), m.id).toBe(0);
  });

  it('raises what stands wholly on a platform, and only that', () => {
    const s = new PixelTqSkin({ platforms: [{ x: 3, y: 3, w: 7, h: 6, color: '#3d6fd1', name: 'Build line' }] }), st = state();
    expect(s.liftOf(station, st)).toBeCloseTo(LIFT.station! + PLATFORM);
    expect(s.liftOf(belt, st)).toBe(LIFT.belt);                                // beside the platform, not on it
  });

  it('keeps the owner\'s picks for what is not said', () => {
    const s = new PixelTqSkin({ raise: undefined, platforms: [{ x: 3, y: 3, w: 7, h: 6, color: '#3d6fd1', name: 'Build line' }] });
    expect(s.liftOf(station, state())).toBeCloseTo(LIFT.station! + PLATFORM);
  });
});

describe('a click on a floor seen from three quarters', () => {
  const view = () => {
    const v = new FactoryView({ getContext: () => null, clientWidth: 1000, clientHeight: 600, width: 0, height: 0 } as unknown as HTMLCanvasElement, new PixelTqSkin());
    v.resize(); v.cam = { x: 6, y: 6, z: 32 };
    return v;
  };
  /* a point of the floor, on the screen */
  const at = (v: FactoryView, x: number, y: number): [number, number] => [(x - v.cam.x) * v.cam.z + v.w / 2, (y - v.cam.y) * v.cam.z + v.h / 2];

  it('hits the station whose lifted top is seen there, not the belt whose tile it is', () => {
    const v = view();
    expect(v.pick(...at(v, 6.5, 3.7), state(), false)).toEqual({ machineId: 's' });   // over the belt's tile, under the station's top
    expect(v.pick(...at(v, 6.5, 3.2), state(), false)).toEqual({ machineId: 'k' });   // higher: the belt behind it
    expect(v.pick(...at(v, 6.5, 7.9), state(), false)).toEqual({ machineId: 's' });   // its front face
  });

  it('hits tiles as they are in build mode, which is flat', () => {
    const v = view();
    expect(v.pick(...at(v, 6.5, 3.7), state({ edit: true }), false)).toEqual({ machineId: 'k' });
  });
});
