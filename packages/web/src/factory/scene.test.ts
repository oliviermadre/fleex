import { describe, expect, it } from 'vitest';
import { FloorScene, type ExitView, type StationView } from './scene';
import type { ViewState } from './renderer';
import type { FactoryLayout, FactoryTicket, MachineSpec } from './types';

const layout = (...machines: MachineSpec[]): FactoryLayout => ({ version: 2, w: 0, h: 0, machines });
const ticket = (id: string, machineId: string | null, phase: FactoryTicket['phase'], more: Partial<FactoryTicket> = {}): FactoryTicket => ({
  ticketId: id, machineId, info: null, x: 0, y: 0, phase, p: 0.5, fx: 1, fy: 0, outcome: '', released: false, since: '2026-01-01T00:00:00Z', runId: null, note: '', handedAt: '2026-01-01T00:00:00Z', ...more,
});
const state = (L: FactoryLayout, tickets: FactoryTicket[], more: Partial<ViewState> = {}): ViewState => ({
  layout: L, tickets, arms: new Map(), selMachine: null, selMany: [], marquee: null, selTicket: null, hoverMachine: null, edit: false, ghost: null, drag: null, ...more,
});

const agent: MachineSpec = { id: 's', kind: 'station', x: 2, y: 0, w: 5, h: 4, name: 'Build', exec: 'agent', outcomes: ['ok'], cap: 2 };
const belt = (id: string, x: number, y: number): MachineSpec => ({ id, kind: 'belt', x, y, w: 1, h: 1, dir: 0 });
const exitBox: MachineSpec = { id: 'x', kind: 'exit', x: 4, y: 0, w: 3, h: 3 };

describe('the scene', () => {
  it('eases a ticket towards where it now is, instead of letting it jump there', () => {
    const sc = new FloorScene(), L = layout(agent), st = state(L, [ticket('t', 's', 'wait')]);
    sc.build(st, 1 / 60);
    const first = { ...sc.shown.get('t')! };
    /* it is moved to the floor, far away: one frame later it has only started going */
    sc.build(state(L, [ticket('t', null, 'loose', { x: 40, y: 30 })]), 1 / 60);
    const next = sc.shown.get('t')!;
    expect(next.x).toBeGreaterThan(first.x);
    expect(next.x).toBeLessThan(40);
  });

  it('puts a station\'s tickets in its places and says which ones run', () => {
    const sc = new FloorScene(), S = sc.build(state(layout(agent), [ticket('a', 's', 'running'), ticket('b', 's', 'wait')]), 1 / 60);
    const v = S.boxes.find((b): b is StationView => b.kind === 'station')!;
    expect(v.places.map((p) => p.t?.mark)).toEqual(['run', 'wait']);
    expect(v.lamp).toBe('on');
  });

  it('sees a ticket that was on its way into an exit leave by it, and counts it', () => {
    const sc = new FloorScene(), L = layout(belt('b', 3, 1), exitBox), exits = { x: 4 };
    sc.build(state(L, [ticket('t', 'b', 'belt', { p: 0.9 })], { exits }), 1 / 60);
    const S = sc.build(state(L, [], { exits }), 1 / 60);
    expect(S.leaving).toHaveLength(1);
    expect((S.boxes.find((b) => b.kind === 'exit') as ExitView).count).toBe(5);
  });

  it('keeps nothing of a ticket that was taken back from the floor', () => {
    const sc = new FloorScene(), L = layout(agent);
    sc.build(state(L, [ticket('t', 's', 'wait')]), 1 / 60);
    const S = sc.build(state(L, []), 1 / 60);
    expect(sc.shown.has('t')).toBe(false);
    expect(S.leaving).toHaveLength(0);
  });

  it('stands still while the floor is stopped', () => {
    const sc = new FloorScene(), L = layout(agent);
    sc.build(state(L, []), 0.5);
    sc.build(state(L, [], { halted: true }), 0.5);
    expect(sc.clock).toBe(0.5);
  });
});
