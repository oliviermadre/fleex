import { describe, it, expect } from 'vitest';
import { FactoryFeed } from '../../src/factory/factory-feed.js';
import type { FactorySnapshot } from '../../src/factory/engine.js';

type T = FactorySnapshot['tickets'][number];
const ticket = (id: string, over: Partial<T> = {}): T => ({ ticketId: id, machineId: 'b1', phase: 'belt', x: 1, y: 1, since: '2026-11-15T10:00:00.000Z', info: null, handedAt: '' , ...over } as T);
const snap = (tickets: T[], over: Partial<FactorySnapshot> = {}): FactorySnapshot => ({
  notice: null, floor: { id: 'default', name: 'Factory', layout: { w: 4, h: 4, machines: [] }, settings: {} } as FactorySnapshot['floor'],
  tickets, arms: [], armSwing: 1.1, beltSpeed: 1, fastBelt: 2, runsLastHour: 0, running: 0, serverTime: '2026-11-15T10:00:00.000Z', ...over,
});

describe('FactoryFeed', () => {
  it('sends everything first, the floor included, then only what changed', () => {
    const f = new FactoryFeed();
    const p1 = f.diff(snap([ticket('a'), ticket('b')]))!;
    expect(p1.seq).toBe(1);
    expect(p1.epoch).toBe(f.epoch);
    expect(new FactoryFeed().epoch).not.toBe(f.epoch);
    expect(p1.tickets.map((t) => t.ticketId)).toEqual(['a', 'b']);
    expect(p1.floor).toBeDefined();
    const p2 = f.diff(snap([ticket('a', { x: 2 }), ticket('b')]))!;
    expect(p2.seq).toBe(2);
    expect(p2.tickets.map((t) => [t.ticketId, t.x])).toEqual([['a', 2]]);
    expect(p2.floor).toBeUndefined();
    expect(f.seq).toBe(2);
  });

  it('makes no patch when only the clock moved', () => {
    const f = new FactoryFeed();
    f.diff(snap([ticket('a')]));
    expect(f.diff(snap([ticket('a')], { serverTime: '2026-11-15T10:00:01.000Z' }))).toBeNull();
    expect(f.seq).toBe(1);
  });

  it('tells which tickets left, once', () => {
    const f = new FactoryFeed();
    f.diff(snap([ticket('a'), ticket('b')]));
    expect(f.diff(snap([ticket('b')]))!.removed).toEqual(['a']);
    expect(f.diff(snap([ticket('b')]))).toBeNull();
  });

  it('sends the floor when its layout or settings change, and the counts and arms whenever a patch goes', () => {
    const f = new FactoryFeed();
    f.diff(snap([]));
    const p = f.diff(snap([], { floor: { ...snap([]).floor, settings: { halted: true } as FactorySnapshot['floor']['settings'] } }))!;
    expect(p.floor?.settings).toEqual({ halted: true });
    const q = f.diff(snap([], { floor: p.floor!, running: 2, arms: [{ id: 'arm', p: 0.5, state: 'carry', carrying: 'a' }] }))!;
    expect(q.floor).toBeUndefined();
    expect(q.running).toBe(2);
    expect(q.arms).toHaveLength(1);
  });
});
