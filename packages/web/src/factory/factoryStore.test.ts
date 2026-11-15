import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FactoryLayout, FactorySnapshot, MachineSpec } from './types';

const saved: FactoryLayout[] = [];
let failNext = false;
const snap = (layout: FactoryLayout): FactorySnapshot => ({
  floor: { id: 'default', name: 'Factory', layout, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } },
  tickets: [], arms: [], runsLastHour: 0, running: 0, serverTime: '2026-11-15T10:00:00.000Z',
});
let server: FactoryLayout;

vi.mock('./factoryApi', () => ({
  factoryApi: {
    state: async () => snap(server),
    setLayout: async (layout: FactoryLayout) => {
      if (failNext) { failNext = false; throw new Error('refused'); }
      saved.push(layout); server = structuredClone(layout);
      return snap(server);
    },
  },
}));

import { resetFactoryHistory, useFactoryStore } from './factoryStore';

const belt = (id: string, x: number): MachineSpec => ({ id, kind: 'belt', x, y: 0, w: 1, h: 1, dir: 0 });
const floor = (...ids: string[]): FactoryLayout => ({ w: 10, h: 10, machines: ids.map((id, i) => belt(id, i)) });
const ids = () => useFactoryStore.getState().layout!.machines.map((m) => m.id).join('');
const store = () => useFactoryStore.getState();

beforeEach(async () => {
  resetFactoryHistory(); saved.length = 0; failNext = false;
  server = floor('a');
  useFactoryStore.setState({ snapshot: null, layout: null, undoable: 0, redoable: 0 });
  await store().refresh();
});

describe('factory layout history', () => {
  it('takes back edits one by one, and puts them back', async () => {
    await store().setLayout(floor('a', 'b'));
    await store().setLayout(floor('a', 'b', 'c'));
    expect([ids(), store().undoable, store().redoable]).toEqual(['abc', 2, 0]);

    await store().undo();
    expect([ids(), store().undoable, store().redoable]).toEqual(['ab', 1, 1]);
    await store().undo();
    expect([ids(), store().undoable, store().redoable]).toEqual(['a', 0, 2]);
    await store().undo();   // nothing left to take back
    expect(ids()).toBe('a');

    await store().redo();
    await store().redo();
    expect([ids(), store().undoable, store().redoable]).toEqual(['abc', 2, 0]);
    expect(saved.map((l) => l.machines.length)).toEqual([2, 3, 2, 1, 2, 3]);
  });

  it('a new edit after an undo drops what could be put back', async () => {
    await store().setLayout(floor('a', 'b'));
    await store().undo();
    await store().setLayout(floor('a', 'z'));
    expect([ids(), store().undoable, store().redoable]).toEqual(['az', 1, 0]);
    await store().redo();
    expect(ids()).toBe('az');
  });

  it('a drag is one step: what is previewed on the way is not remembered', async () => {
    store().beginEdit();
    store().previewLayout(floor('a', 'b'));
    store().previewLayout(floor('a', 'b', 'c'));
    await store().refresh();   // a poll in the middle of the drag changes nothing
    expect(ids()).toBe('abc');
    await store().setLayout(floor('a', 'b', 'c', 'd')).finally(() => store().endEdit());
    expect(store().undoable).toBe(1);
    await store().undo();
    expect(ids()).toBe('a');
  });

  it('saving the layout that is already there is not a step', async () => {
    await store().setLayout(store().layout!);
    expect(store().undoable).toBe(0);
  });

  it('a refused save falls back to what the server holds', async () => {
    failNext = true;
    await store().setLayout(floor('a', 'b'));
    expect(ids()).toBe('a');
  });
});
