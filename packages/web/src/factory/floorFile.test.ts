import { describe, it, expect } from 'vitest';
import { exportFloor, readFloor, setupGap, type Known } from './floorFile';
import type { FactoryLayout, MachineSpec } from './types';

const LAYOUT: FactoryLayout = {
  version: 2, w: 20, h: 10, machines: [
    { id: 'z', kind: 'zone', x: 0, y: 0, w: 3, h: 3, release: 'auto', inbound: true, name: 'Inbound' },
    { id: 's1', kind: 'station', x: 4, y: 0, w: 5, h: 5, name: 'Triage', exec: 'agent', ref: 'toto', model: 'opus-old', outcomes: ['ok'], cap: 2 },
    { id: 's2', kind: 'station', x: 10, y: 0, w: 5, h: 5, name: 'Spec', exec: 'agent', ref: 'Alice', outcomes: ['ok'], cap: 2 },
    { id: 'd', kind: 'desk', x: 0, y: 5, w: 3, h: 3, defaults: { boardId: 'b-shop', type: 'fix' } },
    { id: 'a', kind: 'arm', x: 3, y: 1, w: 1, h: 1, dir: 0, when: [{ field: 'board', op: 'is', values: ['b-shop'] }] },
    { id: 'a2', kind: 'arm', x: 3, y: 2, w: 1, h: 1, dir: 0, when: [{ field: 'board', op: 'is', values: ['b-core'] }] },
    { id: 'p1', kind: 'teleporter', x: 16, y: 0, w: 1, h: 1, role: 'departure', to: 'p2' },
    { id: 'p2', kind: 'teleporter', x: 18, y: 0, w: 1, h: 1, role: 'arrival' },
    { id: 'g', kind: 'belt', x: 16, y: 4, w: 1, h: 1, dir: 0, set: [{ field: 'board', value: 'b-shop' }, { field: 'priority', value: 'high' }] },
  ] as MachineSpec[],
};
const BOARDS = [{ id: 'b-shop', name: 'Shop' }, { id: 'b-core', name: 'Core' }];
const HERE: Known = { personas: ['Alice'], skills: [], panels: [], models: ['claude-x'], boards: [{ id: 'other-core', name: 'core' }] };

describe('a floor as a file', () => {
  it('writes the machines, their settings and the names of the boards they use', () => {
    const f = exportFloor(LAYOUT, [...BOARDS, { id: 'b-unused', name: 'Unused' }], null, new Date('2026-11-24T09:00:00Z'));
    expect(f).toMatchObject({ fleexFloor: 1, layoutVersion: 2, exportedAt: '2026-11-24T09:00:00.000Z', boards: { 'b-shop': 'Shop', 'b-core': 'Core' } });
    expect(f.layout.machines).toHaveLength(LAYOUT.machines.length);
  });

  it('with a selection, only what is selected, from its top-left corner', () => {
    const f = exportFloor(LAYOUT, BOARDS, new Set(['s2', 'p2']));
    expect(f.layout.machines.map((m) => [m.id, m.x, m.y])).toEqual([['s2', 0, 0], ['p2', 8, 0]]);
    expect(f.layout).toMatchObject({ w: 9, h: 5 });
  });

  it('reads it back: every machine placed, what this instance lacks taken off and told, boards matched by name', () => {
    const r = readFloor(JSON.stringify(exportFloor(LAYOUT, BOARDS, null)), 2, HERE);
    if (!r.ok) throw new Error(r.error);
    expect(r.machines).toHaveLength(LAYOUT.machines.length);
    const by = (name: string) => r.machines.find((m) => 'name' in m && m.name === name)!;
    expect(by('Triage')).toMatchObject({ kind: 'station', ref: '' });
    expect(by('Triage')).not.toHaveProperty('model');
    expect(by('Spec')).toMatchObject({ ref: 'Alice' });
    const desk = r.machines.find((m) => m.kind === 'desk')!, arms = r.machines.filter((m) => m.kind === 'arm');
    expect(desk).toMatchObject({ defaults: { type: 'fix' } });
    expect((desk as { defaults: object }).defaults).not.toHaveProperty('boardId');
    expect(arms.map((a) => a.kind === 'arm' && a.when![0]!.values)).toEqual([['b-shop'], ['other-core']]);   // Shop is not here: no ticket is on it, the arm takes nothing; Core is, by another id
    expect(r.machines.find((m) => m.kind === 'belt')).toMatchObject({ set: [{ field: 'priority', value: 'high' }] });
    expect(r.dropped.map((d) => [d.name, d.what])).toEqual([
      ['Triage', 'persona "toto"'], ['Triage', 'model "opus-old": its persona\'s own is used'], ['A desk', 'board "Shop"'],
      ['An arm', 'board "Shop"'], ['An arm', 'its condition on a board is left with none: it takes nothing'], ['A gantry', 'sets board "Shop"'],
    ]);
    expect(r.dropped.find((d) => d.nothing)?.machineId).toBe(arms[0]!.id);
  });

  it('gives new ids and keeps teleporters paired', () => {
    const r = readFloor(JSON.stringify(exportFloor(LAYOUT, BOARDS, null)), 2, HERE);
    if (!r.ok) throw new Error(r.error);
    expect(r.machines.some((m) => LAYOUT.machines.some((q) => q.id === m.id))).toBe(false);
    const dep = r.machines.find((m) => m.kind === 'teleporter' && m.role === 'departure'), arr = r.machines.find((m) => m.kind === 'teleporter' && m.role === 'arrival');
    expect(dep && 'to' in dep && dep.to).toBe(arr!.id);
  });

  it('keeps a model when the list of models is not known for sure', () => {
    const r = readFloor(JSON.stringify(exportFloor(LAYOUT, BOARDS, null)), 2, { ...HERE, models: null });
    expect(r.ok && r.machines.find((m) => 'name' in m && m.name === 'Triage')).toMatchObject({ model: 'opus-old' });
  });

  it('refuses what is not a floor, and a floor of another layout version', () => {
    expect(readFloor('nope', 2, HERE)).toEqual({ ok: false, error: 'This file is not JSON' });
    expect(readFloor('{"a":1}', 2, HERE)).toEqual({ ok: false, error: 'This file is not a Fleex floor' });
    const f = exportFloor(LAYOUT, BOARDS, null);
    expect(readFloor(JSON.stringify({ ...f, layoutVersion: 3 }), 2, HERE)).toMatchObject({ ok: false, error: expect.stringContaining('newer Fleex') });
    expect(readFloor(JSON.stringify({ ...f, layoutVersion: 1 }), 2, HERE)).toMatchObject({ ok: false, error: expect.stringContaining('cannot be carried over') });
  });

  it('says what a station lacks to run', () => {
    const st = (over: object) => ({ id: 's', kind: 'station', x: 0, y: 0, w: 5, h: 5, exec: 'agent', outcomes: ['ok'], cap: 1, ...over }) as MachineSpec;
    expect(setupGap(st({ ref: '' }))).toBe('no persona');
    expect(setupGap(st({ exec: 'skill' }))).toBe('no skill');
    expect(setupGap(st({ ref: 'toto' }), { personas: ['Alice'], skills: [], panels: [] })).toBe('no persona "toto" here');
    expect(setupGap(st({ ref: 'toto' }), { personas: [], skills: [], panels: [] })).toBeNull();               // not loaded yet: nothing to say
    expect(setupGap(st({ exec: 'script' }))).toBe('nothing to run');
    expect(setupGap(st({ exec: 'script', script: { lines: [{ target: 'workspace', kind: 'command', value: 'make' }], missing: 'ignore', onFail: 'all' } }))).toBeNull();
    expect(setupGap(st({ exec: 'human_gate' }))).toBeNull();
    expect(setupGap(LAYOUT.machines[0]!)).toBeNull();
  });
});
