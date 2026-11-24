import { describe, it, expect } from 'vitest';
import { armFacing, canPaste, canPlace, copyOf, erase, machinesIn, move, moveMany, paintBelts, pasteAt, place, rotate, setBelt, setSpeed, specFor } from './layoutOps';
import type { FactoryLayout } from './types';

const empty: FactoryLayout = { w: 20, h: 10, machines: [] };

describe('fast belts', () => {
  const speeds = (l: FactoryLayout) => l.machines.map((m) => (m.kind === 'belt' ? (m.fast ? 'fast' : 'plain') : m.kind));

  it('are laid like belts, with their speed', () => {
    expect(specFor('fastbelt', 2, 3, 1)).toMatchObject({ kind: 'belt', x: 2, y: 3, dir: 1, fast: true });
    expect(specFor('belt', 2, 3, 1)).not.toHaveProperty('fast');
    const { layout } = paintBelts(empty, { x: 1, y: 1 }, { x: 3, y: 1 }, true);
    expect(speeds(layout)).toEqual(['fast', 'fast', 'fast']);
  });

  it('painted over belts, a speed replaces the other and keeps each belt (its id, its place)', () => {
    const plain = paintBelts(empty, { x: 1, y: 1 }, { x: 4, y: 1 }).layout;
    const upgraded = paintBelts(plain, { x: 2, y: 1 }, { x: 3, y: 1 }, true).layout;
    expect(speeds(upgraded)).toEqual(['plain', 'fast', 'fast', 'plain']);
    expect(upgraded.machines.map((m) => m.id)).toEqual(plain.machines.map((m) => m.id));
    const back = paintBelts(upgraded, { x: 1, y: 1 }, { x: 4, y: 1 }).layout;
    expect(speeds(back)).toEqual(['plain', 'plain', 'plain', 'plain']);
    expect(back.machines.every((m) => !('fast' in m))).toBe(true);
    /* nothing changes when the belt is already as asked */
    expect(setBelt(upgraded, 2, 1, 0, true)).toBe(upgraded);
  });

  it('a selection is sped up or slowed down, belts only', () => {
    let l = paintBelts(empty, { x: 1, y: 1 }, { x: 3, y: 1 }).layout;
    l = place(l, specFor('zone', 6, 6, 0)!)!;
    const ids = new Set(l.machines.map((m) => m.id));
    const up = setSpeed(l, ids, true);
    expect(speeds(up)).toEqual(['fast', 'fast', 'fast', 'zone']);
    expect(up.machines.find((m) => m.kind === 'zone')).not.toHaveProperty('fast');
    expect(speeds(setSpeed(up, new Set([l.machines[0]!.id]), false))).toEqual(['plain', 'fast', 'fast', 'zone']);
    /* copied and pasted, a fast belt stays one */
    const clip = copyOf(up, new Set(up.machines.filter((m) => m.kind === 'belt').map((m) => m.id)))!;
    const pasted = pasteAt(empty, clip, 10, 5)!;
    expect(speeds(pasted.layout)).toEqual(['fast', 'fast', 'fast']);
  });
});

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
    expect([station.x, station.y, station.w, station.h]).toEqual([3, 2, 5, 5]);          // a machine of 5 by 5 tiles, centred where it was put
    expect(withStation.machines.filter((m) => m.kind === 'belt').map((m) => m.x)).toEqual([1, 2, 8]);
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
    const arm = { ...specFor('arm', 8, 5, 0)!, when: [{ field: 'outcome' as const, op: 'is' as const, values: ['rework'] }] };
    const inbound = { ...specFor('zone', 12, 2, 0)!, inbound: true };
    const floor: FactoryLayout = { ...empty, machines: [station, arm, inbound, specFor('belt', 15, 9, 0)!] };
    const clip = copyOf(floor, new Set([station.id, arm.id, inbound.id]))!;
    expect([clip.w, clip.h]).toEqual([12, 7]);
    expect(copyOf(floor, new Set(['nope']))).toBeNull();

    const pasted = pasteAt(floor, clip, 30, 20)!;
    expect(pasted.ids).toHaveLength(3);
    expect(pasted.ids.some((id) => [station.id, arm.id, inbound.id].includes(id))).toBe(false);
    const copies = pasted.layout.machines.filter((m) => pasted.ids.includes(m.id));
    expect(copies.find((m) => m.kind === 'station')).toMatchObject({ name: 'Spec', ref: 'catalyst', outcomes: ['ok', 'rework'], x: 24, y: 19 });
    expect(copies.find((m) => m.kind === 'arm')).toMatchObject({ when: [{ field: 'outcome', op: 'is', values: ['rework'] }], x: 29, y: 21 });
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

describe('areas among the machines', () => {
  const line = { id: 'line', kind: 'area', x: 0, y: 0, w: 10, h: 4, name: 'Line', color: '#60a5fa' } as const;
  const floor: FactoryLayout = { w: 0, h: 0, machines: [line, { id: 'b', kind: 'belt', x: 2, y: 1, w: 1, h: 1, dir: 0 }] };

  it('take no tile: machines are placed, found and framed on them as on bare floor', () => {
    expect(canPlace(floor, { x: 4, y: 1, w: 2, h: 2 })).toBe(true);
    expect(place(floor, specFor('zone', 5, 2, 0)!)?.machines.some((m) => m.id === 'line')).toBe(true);
    expect(machinesIn(floor, -1, -1, 20, 20)).toEqual(['b']);
  });

  it('are copied, pasted and moved only where they do not cross another', () => {
    const clip = copyOf(floor, new Set(['line']))!;
    expect(canPaste(floor, clip, 8, 2)).toBe(false);
    expect(canPaste(floor, clip, 30, 2)).toBe(true);
    expect(moveMany(floor, new Set(['line']), 3, 0)).not.toBeNull();
    const two: FactoryLayout = { ...floor, machines: [...floor.machines, { ...line, id: 'other', x: 12 }] };
    expect(moveMany(two, new Set(['other']), -5, 0)).toBeNull();
  });
});

describe('the way an arm faces when it is put down', () => {
  const station = { id: 's', kind: 'station', x: 0, y: 0, w: 5, h: 4, name: 'Dev', exec: 'agent', outcomes: ['ok'], cap: 2 } as const;
  const at = (...machines: unknown[]): FactoryLayout => ({ w: 0, h: 0, machines: machines as FactoryLayout['machines'] });

  it('takes from the station, the zone, the desk or the intake beside it, and drops away from it, on any side', () => {
    const L = at(station);
    expect(armFacing(L, 5, 1, 2)).toBe(0);      // right of it: faces right
    expect(armFacing(L, -1, 1, 0)).toBe(2);     // left of it: faces left
    expect(armFacing(L, 2, 4, 0)).toBe(1);      // under it: faces down
    expect(armFacing(L, 2, -1, 0)).toBe(3);     // above it: faces up
    expect(armFacing(at({ id: 'z', kind: 'zone', x: 0, y: 0, w: 2, h: 2, name: 'In', release: 'auto' }), 2, 0, 3)).toBe(0);
    expect(armFacing(at({ id: 'i', kind: 'intake', x: 0, y: 0, w: 3, h: 2, source: 'gmail' }), 1, 2, 0)).toBe(1);
  });

  it('takes from a belt that ends on it, not from one that leaves it; drops into an exit when nothing gives', () => {
    expect(armFacing(at({ id: 'b', kind: 'belt', x: 3, y: 5, w: 1, h: 1, dir: 1 }), 3, 6, 0)).toBe(1);        // a belt above, pointing down at it
    expect(armFacing(at({ id: 'b', kind: 'belt', x: 3, y: 5, w: 1, h: 1, dir: 0 }), 3, 6, 2)).toBe(2);        // a belt that goes elsewhere: as asked
    expect(armFacing(at({ id: 'x', kind: 'exit', x: 4, y: 6, w: 3, h: 3, name: 'Exit' }), 3, 7, 1)).toBe(0);
  });

  it('between two that give, keeps the way asked when it fits, else drops onto something', () => {
    const two = at(station, { id: 'z', kind: 'zone', x: 6, y: 0, w: 2, h: 2, name: 'Z', release: 'auto' });
    expect(armFacing(two, 5, 1, 2)).toBe(2);   // from the zone into the station, as asked
    expect(armFacing(two, 5, 1, 0)).toBe(0);   // from the station into the zone, as asked
    expect([0, 2]).toContain(armFacing(two, 5, 1, 1));
    expect(armFacing(at(), 3, 3, 1)).toBe(1);  // nothing round it: as asked
  });
});
