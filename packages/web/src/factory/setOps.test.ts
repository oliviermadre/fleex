import { describe, expect, it } from 'vitest';
import { blankOp, choicesFor, incompleteOp, opText, plateLines, SET_FIELDS, type SetOp } from './setOps';
import { gantryAt, rotate, setBelt, specFor } from './layoutOps';
import { hasPopup, isGantry, isToll, type FactoryLayout, type MachineSpec } from './types';

const boards = [{ id: 'b1', name: 'Core product' }, { id: 'b2', name: 'Bugfix' }];
const tag = (op: 'add' | 'remove' | 'set' | 'inc' | 'clear', value: string): SetOp => ({ field: 'tag', op, value });

describe('what a Set gantry does, in words', () => {
  it('is short enough to be read on the floor', () => {
    expect(opText({ field: 'priority', value: 'high' })).toBe('priority → high');
    expect(opText({ field: 'board', value: 'b2' }, (id) => boards.find((b) => b.id === id)!.name)).toBe('board → Bugfix');
    expect(opText({ field: 'type', value: 'none' })).toBe('no type');
    expect(opText({ field: 'favorite', value: 'true' })).toBe('★ favourite');
    expect(opText({ field: 'blocked', value: 'false' })).toBe('not blocked');
    expect(opText(tag('set', 'type:major'))).toBe('type:major');
    expect(opText(tag('inc', 'passes'))).toBe('passes +1');
    expect(opText(tag('inc', 'passes:5'))).toBe('passes +5');
    expect(opText(tag('clear', 'passes'))).toBe('passes ✕');
    expect(opText(tag('add', 'customer'))).toBe('+ customer');
    expect(opText(tag('remove', 'customer'))).toBe('− customer');
  });

  it('a plate shows a few lines, then how many more there are', () => {
    expect(plateLines(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(plateLines(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', '+3 more']);
    expect(plateLines(['a', 'b', 'c', 'd', 'e', 'f'], 12)).toHaveLength(6);
  });

  it('every field has a finite list to choose from, except a tag', () => {
    for (const f of SET_FIELDS) expect(choicesFor(f, boards) === null).toBe(f === 'tag');
    expect(choicesFor('board', boards)).toEqual([{ value: 'b1', label: 'Core product' }, { value: 'b2', label: 'Bugfix' }]);
    expect(blankOp('priority', boards)).toMatchObject({ field: 'priority' });
    expect(blankOp('tag', boards)).toEqual({ field: 'tag', op: 'add', value: '' });
  });

  it('an operation with nothing to set, or a key with no value, is not applied yet', () => {
    expect(incompleteOp(tag('add', ''))).toBe(true);
    expect(incompleteOp(tag('set', 'type'))).toBe(true);
    expect(incompleteOp(tag('set', 'type:major'))).toBe(false);
    expect(incompleteOp(tag('inc', 'passes'))).toBe(false);
    expect(incompleteOp({ field: 'board', value: '' })).toBe(true);
  });
});

describe('putting a gantry on the floor', () => {
  const belt: MachineSpec = { id: 'b', kind: 'belt', x: 3, y: 3, w: 1, h: 1, dir: 1, fast: true };
  const layout: FactoryLayout = { w: 20, h: 20, machines: [belt, { id: 's', kind: 'station', x: 6, y: 1, w: 5, h: 4, name: 'S', exec: 'agent', outcomes: ['ok'], cap: 2 }] };

  it('goes on the belt that is there, which keeps its direction and its speed', () => {
    const done = gantryAt(layout, 3, 3, 0)!;
    expect(done.id).toBe('b');
    expect(done.layout.machines.find((m) => m.id === 'b')).toEqual({ ...belt, set: [] });
    expect(gantryAt(done.layout, 3, 3, 0)).toBeNull();                       // it has one already
  });
  it('comes with a belt of its own on bare floor, and goes nowhere else', () => {
    const done = gantryAt(layout, 0, 0, 2)!, made = done.layout.machines.find((m) => m.id === done.id)!;
    expect(made).toMatchObject({ kind: 'belt', x: 0, y: 0, dir: 2, set: [] });
    expect(gantryAt(layout, 7, 2, 0)).toBeNull();                            // a station stands there
    expect(specFor('set', 1, 1, 3)).toMatchObject({ kind: 'belt', dir: 3, set: [] });
  });
  it('a belt with a gantry has something to set, so it opens; a plain belt does not', () => {
    expect(hasPopup(belt)).toBe(false); expect(isGantry(belt)).toBe(false);
    const g = { ...belt, set: [] } as MachineSpec;
    expect(hasPopup(g)).toBe(true); expect(isGantry(g)).toBe(true);
  });
});

describe('putting a toll on the floor', () => {
  const belt: MachineSpec = { id: 'b', kind: 'belt', x: 3, y: 3, w: 1, h: 1, dir: 0 };
  const layout: FactoryLayout = { w: 20, h: 20, machines: [belt] };
  const tollOf = (l: FactoryLayout) => l.machines.find((m) => m.id === 'b') as MachineSpec & { toll?: { when: unknown[]; out: number }; set?: unknown[] };

  it('is a gantry with something to reject, to the right of the way the belt runs until said otherwise', () => {
    const done = gantryAt(layout, 3, 3, 2, true)!;
    expect(tollOf(done.layout)).toMatchObject({ dir: 0, set: [], toll: { when: [], out: 1 } });
    expect(isToll(tollOf(done.layout))).toBe(true); expect(isGantry(tollOf(done.layout))).toBe(true);
    expect(specFor('toll', 0, 0, 1)).toMatchObject({ kind: 'belt', dir: 1, set: [], toll: { out: 2 } });
    expect(gantryAt(done.layout, 3, 3, 0, true)).toBeNull();                 // it is one already
  });
  it('a gantry becomes a toll and keeps what it sets', () => {
    const g = gantryAt(layout, 3, 3, 0)!.layout, set = [{ field: 'priority', value: 'high' }];
    const withOps = { ...g, machines: g.machines.map((m) => ({ ...m, set })) } as FactoryLayout;
    expect(tollOf(gantryAt(withOps, 3, 3, 0, true)!.layout)).toMatchObject({ set, toll: { out: 1 } });
  });
  it('its arm turns with its belt, so it still reaches across it', () => {
    const t = gantryAt(layout, 3, 3, 0, true)!.layout;
    expect(tollOf(rotate(t, 'b'))).toMatchObject({ dir: 1, toll: { out: 2 } });
    expect(tollOf(setBelt(t, 3, 3, 3))).toMatchObject({ dir: 3, toll: { out: 0 } });
    expect(tollOf(rotate(layout, 'b')).toll).toBeUndefined();                // a plain belt just turns
  });
});
