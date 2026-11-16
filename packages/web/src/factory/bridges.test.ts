import { describe, it, expect } from 'vitest';
import { bridgeFlow, flowLabel } from './bridges';
import type { Dir, MachineSpec } from './types';

const belt = (x: number, y: number, dir: Dir): MachineSpec => ({ id: `b${x},${y}`, kind: 'belt', x, y, w: 1, h: 1, dir });
const arm = (x: number, y: number, dir: Dir): MachineSpec => ({ id: `a${x},${y}`, kind: 'arm', x, y, w: 1, h: 1, dir, when: [] });
const bridge = (x: number, y: number): MachineSpec => ({ id: `x${x},${y}`, kind: 'bridge', x, y, w: 1, h: 1 });
const floor = (machines: MachineSpec[]) => (x: number, y: number) => machines.find((m) => m.x === x && m.y === y) ?? null;
const flow = (machines: MachineSpec[], x = 5, y = 5) => bridgeFlow(floor(machines), machines.find((m) => m.kind === 'bridge' && m.x === x && m.y === y)!);
const EAST = 0, SOUTH = 1, WEST = 2, NORTH = 3;

describe('the way a bridge flows', () => {
  it('each lane goes the way the belt that feeds it points, in any of the four directions', () => {
    expect(flow([bridge(5, 5), belt(4, 5, EAST), belt(6, 5, EAST), belt(5, 4, SOUTH), belt(5, 6, SOUTH)])).toEqual({ over: EAST, under: SOUTH });
    expect(flow([bridge(5, 5), belt(6, 5, WEST), belt(4, 5, WEST), belt(5, 6, NORTH), belt(5, 4, NORTH)])).toEqual({ over: WEST, under: NORTH });
    expect(flow([bridge(5, 5), belt(4, 5, EAST), belt(6, 5, EAST), belt(5, 6, NORTH), belt(5, 4, NORTH)])).toEqual({ over: EAST, under: NORTH });
    expect(flow([bridge(5, 5), belt(6, 5, WEST), belt(4, 5, WEST), belt(5, 4, SOUTH), belt(5, 6, SOUTH)])).toEqual({ over: WEST, under: SOUTH });
  });

  it('a belt that turns after the bridge does not change the way the lane flows', () => {
    expect(flow([bridge(5, 5), belt(6, 5, WEST), belt(4, 5, NORTH)]).over).toBe(WEST);
    expect(flow([bridge(5, 5), belt(5, 6, NORTH), belt(5, 4, EAST)]).under).toBe(NORTH);
  });

  it('an arm that drops on a bridge feeds it too', () => {
    expect(flow([bridge(5, 5), arm(6, 5, WEST)]).over).toBe(WEST);
    expect(flow([bridge(5, 5), arm(5, 4, SOUTH)]).under).toBe(SOUTH);
    expect(flow([bridge(5, 5), arm(6, 5, NORTH)]).over).toBe('none');   // it stands next to the bridge, but drops elsewhere
  });

  it('bridges side by side flow as one: the belt before the first says it for all', () => {
    const run = [belt(8, 5, WEST), bridge(7, 5), bridge(6, 5), bridge(5, 5), belt(4, 5, WEST), belt(6, 6, NORTH), belt(6, 4, NORTH)];
    expect([flow(run, 7, 5).over, flow(run, 6, 5).over, flow(run, 5, 5).over]).toEqual([WEST, WEST, WEST]);
    expect([flow(run, 7, 5).under, flow(run, 6, 5).under]).toEqual(['none', NORTH]);
  });

  it('says so when nothing feeds a lane, and when both ends do', () => {
    expect(flow([bridge(5, 5)])).toEqual({ over: 'none', under: 'none' });
    expect(flow([bridge(5, 5), belt(4, 5, EAST), belt(6, 5, WEST)]).over).toBe('clash');
    /* nothing pushes in yet, but the belt that leads away says where the lane is meant to go */
    expect(flow([bridge(5, 5), belt(4, 5, WEST)]).over).toBe(WEST);
    expect(flow([bridge(5, 5), belt(5, 6, SOUTH)]).under).toBe(SOUTH);
    expect(flow([bridge(5, 5), belt(4, 5, WEST), belt(6, 5, EAST)]).over).toBe('none');   // both lead away: nothing can cross
  });

  it('puts it in words', () => {
    expect([flowLabel(WEST), flowLabel(NORTH), flowLabel('none'), flowLabel('clash')]).toEqual(['towards the west', 'towards the north', 'no belt feeds it yet', 'fed from both ends: tickets would meet head-on']);
  });
});
