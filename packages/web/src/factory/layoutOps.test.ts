import { describe, it, expect } from 'vitest';
import { canPaste, canPlace, copyOf, erase, machinesIn, move, moveMany, paintBelts, pasteAt, place, rotate, setBelt, specFor } from './layoutOps';
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
  it('copies a group with its settings and pastes it elsewhere under new ids', () => {
    const station = { ...specFor('agent', 5, 5, 0)!, name: 'Spec', ref: 'catalyst', outcomes: ['ok', 'rework'] };
    const arm = { ...specFor('arm', 7, 5, 0)!, when: [{ field: 'outcome' as const, op: 'is' as const, values: ['rework'] }] };
    const inbound = { ...specFor('zone', 12, 2, 0)!, inbound: true };
    const floor: FactoryLayout = { ...empty, machines: [station, arm, inbound, specFor('belt', 15, 9, 0)!] };
    const clip = copyOf(floor, new Set([station.id, arm.id, inbound.id]))!;
    expect([clip.w, clip.h]).toEqual([11, 6]);
    expect(copyOf(floor, new Set(['nope']))).toBeNull();

    const pasted = pasteAt(floor, clip, 30, 20)!;
    expect(pasted.ids).toHaveLength(3);
    expect(pasted.ids.some((id) => [station.id, arm.id, inbound.id].includes(id))).toBe(false);
    const copies = pasted.layout.machines.filter((m) => pasted.ids.includes(m.id));
    expect(copies.find((m) => m.kind === 'station')).toMatchObject({ name: 'Spec', ref: 'catalyst', outcomes: ['ok', 'rework'], x: 25, y: 20 });
    expect(copies.find((m) => m.kind === 'arm')).toMatchObject({ when: [{ field: 'outcome', op: 'is', values: ['rework'] }], x: 28, y: 21 });
    expect(copies.find((m) => m.kind === 'zone')).toMatchObject({ inbound: false });
    expect(pasted.layout.machines).toHaveLength(7);
    /* the originals are untouched, and a later change to a copy does not reach the clip */
    expect(floor.machines).toHaveLength(4);
    (copies.find((m) => m.kind === 'station') as { outcomes: string[] }).outcomes.push('x');
    expect((clip.machines.find((m) => m.kind === 'station') as { outcomes: string[] }).outcomes).toEqual(['ok', 'rework']);
  });

  it('refuses to paste onto a machine, and lets belts give way', () => {
    const station = specFor('agent', 5, 5, 0)!;
    const floor: FactoryLayout = { ...empty, machines: [station, specFor('belt', 20, 5, 0)!, specFor('belt', 21, 5, 0)!] };
    const clip = copyOf(floor, new Set([station.id]))!;
    expect(canPaste(floor, clip, 6, 6)).toBe(false);
    expect(pasteAt(floor, clip, 6, 6)).toBeNull();
    const over = pasteAt(floor, clip, 20, 5)!;
    expect(over.layout.machines.filter((m) => m.kind === 'belt')).toHaveLength(0);
    expect(over.layout.machines.filter((m) => m.kind === 'station')).toHaveLength(2);
  });
});
