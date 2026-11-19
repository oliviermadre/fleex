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
    expect(flow([bridge(5, 5), belt(4, 5, EAST), belt(6, 5, EAST), belt(5, 4, SOUTH), belt(5, 6, SOUTH)])).toMatchObject({ over: EAST, under: SOUTH });
    expect(flow([bridge(5, 5), belt(6, 5, WEST), belt(4, 5, WEST), belt(5, 6, NORTH), belt(5, 4, NORTH)])).toMatchObject({ over: WEST, under: NORTH });
    expect(flow([bridge(5, 5), belt(4, 5, EAST), belt(6, 5, EAST), belt(5, 6, NORTH), belt(5, 4, NORTH)])).toMatchObject({ over: EAST, under: NORTH });
    expect(flow([bridge(5, 5), belt(6, 5, WEST), belt(4, 5, WEST), belt(5, 4, SOUTH), belt(5, 6, SOUTH)])).toMatchObject({ over: WEST, under: SOUTH });
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
    expect(flow([bridge(5, 5)])).toMatchObject({ over: 'none', under: 'none' });
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

describe('how fast a bridge lane goes', () => {
  const fast = (x: number, y: number, dir: Dir): MachineSpec => ({ ...belt(x, y, dir), fast: true } as MachineSpec);

  it('goes at the speed of the belt that feeds it, each lane on its own', () => {
    /* a fast line east-west over a plain line north-south */
    expect(flow([bridge(5, 5), fast(4, 5, EAST), fast(6, 5, EAST), belt(5, 4, SOUTH), belt(5, 6, SOUTH)])).toEqual({ over: EAST, under: SOUTH, overFast: true, underFast: false });
    /* the other way round, and both */
    expect(flow([bridge(5, 5), belt(4, 5, EAST), belt(6, 5, EAST), fast(5, 6, NORTH), fast(5, 4, NORTH)])).toMatchObject({ overFast: false, underFast: true });
    expect(flow([bridge(5, 5), fast(6, 5, WEST), fast(5, 4, SOUTH)])).toMatchObject({ over: WEST, under: SOUTH, overFast: true, underFast: true });
  });

  it('is the feeding belt that counts, not the one it leads to; unless an arm feeds it', () => {
    expect(flow([bridge(5, 5), belt(4, 5, EAST), fast(6, 5, EAST)]).overFast).toBe(false);
    expect(flow([bridge(5, 5), fast(4, 5, EAST), belt(6, 5, EAST)]).overFast).toBe(true);
    expect(flow([bridge(5, 5), arm(4, 5, EAST), fast(6, 5, EAST)]).overFast).toBe(true);
    expect(flow([bridge(5, 5), arm(4, 5, EAST), belt(6, 5, EAST)]).overFast).toBe(false);
  });

  it('holds along a run of bridges, and a lane nothing feeds or fed from both ends is not fast', () => {
    const run = [bridge(5, 5), bridge(6, 5), bridge(7, 5), fast(4, 5, EAST), belt(8, 5, EAST)];
    expect([5, 6, 7].map((x) => flow(run, x, 5).overFast)).toEqual([true, true, true]);
    expect(flow([bridge(5, 5)])).toEqual({ over: 'none', under: 'none', overFast: false, underFast: false });
    expect(flow([bridge(5, 5), fast(4, 5, EAST), fast(6, 5, WEST)])).toMatchObject({ over: 'clash', overFast: false });
  });
});
