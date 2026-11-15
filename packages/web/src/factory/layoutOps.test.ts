import { describe, it, expect } from 'vitest';
import { canPlace, erase, machinesIn, move, moveMany, paintBelts, place, rotate, setBelt, specFor } from './layoutOps';
import type { FactoryLayout } from './types';

const empty: FactoryLayout = { w: 20, h: 10, machines: [] };

describe('factory layout edits', () => {
  it('paints belts along a drag, each tile pointing at the next', () => {
    const { layout, dir } = paintBelts(empty, { x: 1, y: 1 }, { x: 3, y: 2 });
    expect(layout.machines.map((m) => [m.x, m.y, m.kind === 'belt' ? m.dir : -1])).toEqual([[1, 1, 0], [2, 1, 0], [3, 1, 1], [3, 2, 1]]);
    expect(dir).toBe(1);
  });

  it('re-aims a belt it passes over again instead of stacking a second one', () => {
    const once = setBelt(empty, 2, 2, 0), twice = setBelt(once, 2, 2, 3);
    expect(twice.machines).toHaveLength(1);
    expect(twice.machines[0]).toMatchObject({ kind: 'belt', dir: 3 });
    expect(setBelt(twice, 2, 2, 3)).toBe(twice);
  });

  it('lets a station take the place of belts, but not of another machine', () => {
    const belts = paintBelts(empty, { x: 1, y: 4 }, { x: 8, y: 4 }).layout;
    const station = specFor('agent', 5, 4, 0)!;
    const withStation = place(belts, station)!;
    expect(withStation.machines.filter((m) => m.kind === 'belt').map((m) => m.x)).toEqual([1, 2, 3, 7, 8]);
    expect(place(withStation, specFor('gate', 6, 4, 0)!)).toBeNull();
    expect(canPlace(withStation, { x: -40, y: 80, w: 3, h: 3 })).toBe(true);          // the floor has no edge
  });

  it('moves a selection as one block, or not at all', () => {
    const line = paintBelts(empty, { x: 1, y: 1 }, { x: 4, y: 1 }).layout, gate = specFor('gate', 10, 5, 0)!, l = place(line, gate)!;
    const ids = new Set(machinesIn(l, 0, 0, 6, 3));
    expect(ids.size).toBe(4);
    const moved = moveMany(l, ids, 0, 10)!;
    expect(moved.machines.filter((m) => m.kind === 'belt').map((m) => m.y)).toEqual([11, 11, 11, 11]);
    expect(moveMany(l, ids, 8, 4)).toBeNull();                                       // would land on the gate
    expect(moveMany(l, new Set([...ids, gate.id]), 8, 4)).not.toBeNull();           // unless the gate moves with them
  });

  it('moves, rotates and erases a machine', () => {
    const arm = specFor('arm', 2, 2, 0)!;
    let l = place(empty, arm)!;
    l = rotate(l, arm.id);
    expect(l.machines[0]).toMatchObject({ dir: 1 });
    l = move(l, arm.id, 5, 5)!;
    expect(l.machines[0]).toMatchObject({ x: 5, y: 5 });
    expect(move(l, arm.id, -1, 0)!.machines[0]).toMatchObject({ x: -1, y: 0 });
    expect(erase(l, arm.id).machines).toEqual([]);
  });
});
