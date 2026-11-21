import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FactoryPatch, FactorySnapshot, FactoryTicket } from './types';

let server: FactorySnapshot;
let reads = 0;
vi.mock('./factoryApi', () => ({ factoryApi: { state: async () => { reads++; return structuredClone(server); }, halt: async () => structuredClone(server) } }));

import { resetFactoryHistory, useFactoryStore } from './factoryStore';

const ticket = (id: string, over: Partial<FactoryTicket> = {}): FactoryTicket => ({ ticketId: id, machineId: 'b1', phase: 'belt', x: 1, y: 1, since: '', info: null, handedAt: '', ...over } as FactoryTicket);
const snap = (tickets: FactoryTicket[], seq: number, epoch = 'e1'): FactorySnapshot => ({
  floor: { id: 'default', name: 'Factory', layout: { w: 4, h: 4, machines: [] }, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } },
  tickets, arms: [], runsLastHour: 0, running: 0, serverTime: '2026-11-15T10:00:00.000Z', epoch, seq,
});
const patch = (seq: number, over: Partial<FactoryPatch> = {}): FactoryPatch => ({
  epoch: 'e1', seq, tickets: [], removed: [], arms: [], runsLastHour: 0, running: 0, serverTime: '2026-11-15T10:00:01.000Z', ...over,
});
const store = () => useFactoryStore.getState();
const shown = () => store().snapshot!.tickets.map((t) => `${t.ticketId}@${t.x}`).join(' ');
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(async () => {
  resetFactoryHistory(); reads = 0;
  useFactoryStore.setState({ snapshot: null, layout: null });
  server = snap([ticket('a'), ticket('b')], 3);
  await store().refresh();
  reads = 0;
});

describe('factory live patches', () => {
  it('applies the next patch: changed tickets in place, new ones added, gone ones removed', () => {
    store().applyPatch(patch(4, { tickets: [ticket('b', { x: 2 }), ticket('c')], removed: ['a'], running: 1 }));
    expect(shown()).toBe('b@2 c@1');
    expect(store().snapshot!.running).toBe(1);
    expect(store().snapshot!.seq).toBe(4);
    expect(reads).toBe(0);
  });

  it('takes the intakes\' counts a patch carries, and keeps them when it carries none', () => {
    store().applyPatch(patch(4, { intakes: { in: { dropped: 2 } } }));
    expect(store().snapshot!.intakes).toEqual({ in: { dropped: 2 } });
    store().applyPatch(patch(5));
    expect(store().snapshot!.intakes).toEqual({ in: { dropped: 2 } });
  });

  it('keeps the tickets a patch did not touch as they were, for the views that compare them', () => {
    const b = store().snapshot!.tickets[1];
    store().applyPatch(patch(4, { tickets: [ticket('a', { x: 3 })] }));
    expect(store().snapshot!.tickets[1]).toBe(b);
  });

  it('drops a patch it already holds', () => {
    store().applyPatch(patch(3, { tickets: [ticket('a', { x: 9 })] }));
    expect(shown()).toBe('a@1 b@1');
    expect(reads).toBe(0);
  });

  it('reads the whole floor again, once, after a gap', async () => {
    server = snap([ticket('a', { x: 5 })], 6);
    store().applyPatch(patch(5));
    store().applyPatch(patch(6));
    await settle();
    expect(reads).toBe(1);
    expect(shown()).toBe('a@5');
    store().applyPatch(patch(7, { tickets: [ticket('a', { x: 6 })] }));
    expect(shown()).toBe('a@6');
  });

  it('reads the whole floor again when the server restarted', async () => {
    server = snap([ticket('z')], 0, 'e2');
    store().applyPatch(patch(1, { epoch: 'e2' }));
    await settle();
    expect(reads).toBe(1);
    expect(shown()).toBe('z@1');
  });

  it("drops an action's answer older than a patch already applied", async () => {
    store().applyPatch(patch(4, { tickets: [ticket('a', { x: 4 })] }));
    server = snap([ticket('a', { x: 1 })], 3);
    await store().halt(true);
    expect(shown()).toBe('a@4 b@1');
  });
});
