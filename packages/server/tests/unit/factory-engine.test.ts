/**
 * The Factory engine, on an in-memory store and a fake station runner: belts,
 * arms and their filters, stations and their outcomes, gates, zones, the exit,
 * the safety limits and what survives a restart.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FactoryEngine, FactoryError, normaliseLayout } from '../../src/factory/engine.js';
import type { SetOp, TicketChange } from '../../src/factory/set-ops.js';
import { LAYOUT_VERSION, upgradeLayout, versionOf } from '../../src/factory/layout-versions.js';
import type { FactoryStorePort } from '../../src/factory/factory-store.port.js';
import type { StationRunResult } from '../../src/factory/station-runner.js';
import type { ArmCondition, FactoryFloorRow, FactoryItemRow, FactoryLayout, FactoryRunRow, FactoryTicketInfo, FactoryTicketRow, MachineSpec, StationSpec } from '../../src/factory/types.js';

class MemoryStore implements FactoryStorePort {
  floors = new Map<string, FactoryFloorRow>();
  get floor(): FactoryFloorRow | null { return this.floors.get('default') ?? null; }
  tickets = new Map<string, FactoryTicketRow>();
  runs = new Map<string, FactoryRunRow>();
  async getFloor(id: string) { return this.floors.get(id) ?? null; }
  async saveFloor(f: FactoryFloorRow) { this.floors.set(f.id, structuredClone(f)); }
  async listTickets() { return [...this.tickets.values()].map((t) => structuredClone(t)); }
  async saveTicket(t: FactoryTicketRow) { this.tickets.set(t.ticketId, structuredClone(t)); }
  async removeTicket(id: string) { this.tickets.delete(id); }
  async listManagedTicketIds() { return [...this.tickets.keys()]; }
  items = new Map<string, FactoryItemRow>();
  async listItems() { return [...this.items.values()].filter((i) => !i.archivedAt).map((i) => structuredClone(i)); }
  async getItemByKey(source: string, key: string) { const i = [...this.items.values()].find((x) => x.source === source && x.sourceKey === key); return i ? structuredClone(i) : null; }
  async saveItem(i: FactoryItemRow) { this.items.set(i.id, structuredClone(i)); }
  async countDropped() { const out: Record<string, number> = {}; for (const i of this.items.values()) if (i.archivedReason === 'dropped' && i.intakeId) out[i.intakeId] = (out[i.intakeId] ?? 0) + 1; return out; }
  async saveRun(r: FactoryRunRow) { this.runs.set(r.id, structuredClone(r)); }
  async listRunsByTicket(id: string) { return [...this.runs.values()].filter((r) => r.ticketId === id); }
  async listRecentRuns() { return [...this.runs.values()]; }
  async listRunsSince() { return [...this.runs.values()]; }
  async countRunsSince() { return 0; }
  async interruptRunningRuns(nowIso: string) {
    const out: FactoryRunRow[] = [];
    for (const r of this.runs.values()) if (r.status === 'running') { r.status = 'interrupted'; r.finishedAt = nowIso; out.push(r); }
    return out;
  }
}

const belt = (id: string, x: number, y: number, dir: 0 | 1 | 2 | 3 = 0): MachineSpec => ({ id, kind: 'belt', x, y, w: 1, h: 1, dir });
const arm = (id: string, x: number, y: number, dir: 0 | 1 | 2 | 3, field?: 'type' | 'priority' | 'outcome' | 'tag', values?: string[]): MachineSpec =>
  ({ id, kind: 'arm', x, y, w: 1, h: 1, dir, filter: field ? { field, values: values ?? [] } : null });
const zone = (id: string, x: number, y: number, over: Partial<MachineSpec> = {}): MachineSpec => ({ id, kind: 'zone', x, y, w: 2, h: 2, name: id, release: 'manual', ...over } as MachineSpec);
const station = (id: string, x: number, y: number, over: Partial<StationSpec> = {}): MachineSpec =>
  ({ id, kind: 'station', x, y, w: 3, h: 3, name: id, exec: 'agent', ref: 'builder', outcomes: ['ok'], cap: 8, ...over });
const exit = (id: string, x: number, y: number): MachineSpec => ({ id, kind: 'exit', x, y, w: 1, h: 1, name: id });

let store: MemoryStore;
let infos: Map<string, FactoryTicketInfo>;
let statuses: [string, string][];
let pending: { station: string; ticketId: string; resolve: (r: StationRunResult) => void; started: (executionId: string) => void }[];
let cancelled: string[];
let decisions: [string, string, string, string][];
let clock: number;
/** What gantries wrote on tickets, and how the write behaves: at once, held until released, or failing. */
let changes: [string, TicketChange][];
let writes: { hold: boolean; fail: boolean; release: (() => void)[] };
let engine: FactoryEngine;

const info = (id: string, over: Partial<FactoryTicketInfo> = {}): FactoryTicketInfo => ({ id, displayId: 1, title: id, type: 'build', priority: 'medium', status: 'todo', tags: [], boardId: 'b1', complexity: null, favorite: false, blocked: false, ...over });
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
/** Advance the floor by `seconds`, in small ticks, letting async work land in between. */
const run = async (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { clock += 100; engine.tick(0.1); await settle(); } };
const where = (ticketId: string) => { const t = engine.snapshot().tickets.find((x) => x.ticketId === ticketId); return t ? `${t.machineId ?? 'floor'}:${t.phase}` : 'gone'; };

/** The floor's own paces (a slow arm, a rest in each station) are asked for by the tests that are about them; the others run brisk. */
const BRISK = { armSwing: 0.45, stationRestMs: 0, teleportRestMs: 0 };
async function boot(machines: MachineSpec[], w = 30, h = 12, timing: { armSwing?: number; stationRestMs?: number; teleportRestMs?: number } | 'real' = BRISK): Promise<void> {
  const layout: FactoryLayout = { w, h, machines };
  engine = new FactoryEngine({
    store, now: () => clock, logger: { warn: () => {}, info: () => {} }, timing: timing === 'real' ? undefined : timing,
    loadTicket: async (id) => infos.get(id) ?? null,
    setStatus: async (id, status) => { statuses.push([id, status]); },
    runner: { run: (s, ticketId, _runId, _targets, started) => new Promise<StationRunResult>((resolve) => { pending.push({ station: s.id, ticketId, resolve, started }); }) },
    cancelExecution: async (id) => { cancelled.push(id); },
    applyChange: async (id, change) => {
      if (writes.hold) await new Promise<void>((resolve) => { writes.release.push(resolve); });
      if (writes.fail) throw new Error('database is away');
      changes.push([id, change]);
      const was = infos.get(id)!;
      infos.set(id, { ...was, ...(change.status ? { status: change.status } : {}), ...change.fields } as FactoryTicketInfo);
    },
    recordDecision: async (ticketId, gate, outcome, reason) => { decisions.push([ticketId, gate, outcome, reason]); },
  });
  await engine.init();
  await engine.setLayout(layout);
}

beforeEach(() => {
  store = new MemoryStore(); infos = new Map(); statuses = []; pending = []; cancelled = []; decisions = []; changes = []; writes = { hold: false, fail: false, release: [] }; clock = Date.parse('2026-11-15T10:00:00.000Z');
  for (const id of ['a', 'b', 'c']) infos.set(id, info(id));
});

describe('FactoryEngine', () => {
  it('carries a ticket along belts into a zone, which sets its status', async () => {
    await boot([belt('b1', 1, 1), belt('b2', 2, 1), belt('b3', 3, 1), zone('todo', 4, 1, { status: 'todo' })]);
    await engine.transfer('a', { machineId: 'b1' });
    expect(where('a')).toBe('b1:belt');
    await run(3);
    expect(where('a')).toBe('todo:zone');
    expect(statuses).toEqual([]);                       // already todo: nothing to write
    infos.set('b', info('b', { status: 'backlog' }));
    await engine.transfer('b', { machineId: 'b1' });
    await run(3);
    expect(statuses).toEqual([['b', 'todo']]);
  });

  describe('items and intakes', () => {
    const intake = (id: string, x: number, y: number, over: Record<string, unknown> = {}) => ({ id, kind: 'intake', x, y, w: 3, h: 2, source: 'slack', quietSec: 60, ...over }) as unknown as MachineSpec;
    const msg = (key: string, over: Record<string, unknown> = {}) => ({ source: 'slack' as const, key, title: `hi ${key}`, author: 'Ana', excerpt: 'can you look', url: 'https://x.slack.com/archives/C1/p1', ...over });

    it('an item waits in its intake while its conversation moves, and leaves once it has been quiet', async () => {
      await boot([intake('in', 1, 1, { drop: [{ field: 'author', contains: 'newsletter' }] }), arm('a1', 4, 1, 0), belt('b1', 5, 1), zone('z', 6, 1)]);
      const first = await engine.ingest(msg('k1'));
      expect(first.status).toBe('new');
      const id = first.itemId!;
      expect(where(id)).toBe('in:zone');
      await run(40);
      expect(await engine.ingest(msg('k1', { title: 'the real ask', excerpt: 'please fix the cart' }))).toEqual({ itemId: id, status: 'updated' });
      await run(40);
      expect(where(id)).toBe('in:zone');                // 40 s since the last message: not quiet enough
      await run(25);
      await run(8);
      expect(where(id)).toBe('z:zone');
      const tok = engine.snapshot().tickets.find((t) => t.ticketId === id)!;
      expect(tok.item).toMatchObject({ source: 'slack', author: 'Ana', messages: 2, excerpt: 'please fix the cart' });
      expect(tok.info).toMatchObject({ title: 'the real ask', type: 'src:slack', tags: ['source:slack'] });
      await engine.flush();
      expect(store.items.get(id)).toMatchObject({ machineId: 'z', archivedAt: null });
      /* items are not tickets: nothing written as one, nothing counted as one */
      expect(statuses).toEqual([]);
      expect(engine.managedIds().has(id)).toBe(false);
    });

    it('an intake drops what its rules recognise, counts it, and it never reaches the floor', async () => {
      await boot([intake('in', 1, 1, { drop: [{ field: 'author', contains: 'NewsLetter' }, { field: 'text', contains: 'unsubscribe' }] })]);
      expect((await engine.ingest(msg('n1', { author: 'The newsletter team' }))).status).toBe('dropped');
      expect((await engine.ingest(msg('n2', { excerpt: 'click to Unsubscribe' }))).status).toBe('dropped');
      expect((await engine.ingest(msg('n3'))).status).toBe('new');
      expect(engine.snapshot().tickets).toHaveLength(1);
      expect(engine.snapshot().intakes).toEqual({ in: { dropped: 2 } });
      expect([...store.items.values()].filter((i) => i.archivedReason === 'dropped')).toHaveLength(2);
    });

    it('an item reaching an exit, or archived by hand, is archived; a new message brings it back to its intake', async () => {
      await boot([intake('in', 1, 1, { quietSec: 0 }), arm('a1', 4, 1, 0), exit('x', 5, 1)]);
      const { itemId } = await engine.ingest(msg('k'));
      await run(5);
      expect(where(itemId!)).toBe('gone');
      expect(store.items.get(itemId!)).toMatchObject({ archivedReason: 'exit', machineId: null });
      expect(statuses).toEqual([]);
      expect(await engine.ingest(msg('k'))).toEqual({ itemId, status: 'back' });
      expect(where(itemId!)).toBe('in:zone');
      expect(store.items.get(itemId!)).toMatchObject({ archivedAt: null, messages: 2 });
      await engine.archiveItem(itemId!);
      expect(store.items.get(itemId!)).toMatchObject({ archivedReason: 'junk' });
      await expect(engine.archiveItem('nope')).rejects.toBeInstanceOf(FactoryError);
    });

    it('a station sets an item aside, a gantry leaves it untouched, and the floor keeps it across a restart', async () => {
      await boot([intake('in', 1, 1, { quietSec: 0 }), arm('a1', 4, 1, 0), { id: 'g', kind: 'belt', x: 5, y: 1, w: 1, h: 1, dir: 0, set: [{ field: 'priority', value: 'high' }] } as MachineSpec, station('s', 6, 1)]);
      const { itemId } = await engine.ingest(msg('k'));
      await run(8);
      expect(where(itemId!)).toBe('s:failed');
      expect(changes).toEqual([]);
      expect(pending).toEqual([]);
      await engine.flush();
      const again = new FactoryEngine({ store, now: () => clock, logger: { warn: () => {}, info: () => {} }, timing: BRISK, loadTicket: async () => null, setStatus: async () => {}, runner: { run: () => new Promise<StationRunResult>(() => {}) } });
      await again.init();
      expect(again.snapshot().tickets.find((t) => t.ticketId === itemId)).toMatchObject({ machineId: 's', phase: 'failed', item: { source: 'slack' } });
    });

    it('refuses an item with no intake for its source, or with no key', async () => {
      await boot([intake('in', 1, 1)]);
      await expect(engine.ingest(msg('k', { source: 'gmail' }))).rejects.toThrow('No gmail intake on the floor');
      await expect(engine.ingest(msg(''))).rejects.toThrow('an item needs its key');
      await expect(engine.move('a', { machineId: 'in' })).rejects.toBeInstanceOf(FactoryError);
    });
  });

  it('a desk holds the ticket created at it until an arm takes it out, and takes nothing from the floor', async () => {
    const desk = { id: 'desk', kind: 'desk', x: 1, y: 1, w: 9, h: 9, name: '  Bug desk ', defaults: { boardId: 'b1', type: 'fix', priority: 7, junk: 'x' } } as unknown as MachineSpec;
    await boot([desk, arm('a1', 4, 1, 0), belt('b1', 5, 1), zone('z', 6, 1)]);
    expect(engine.snapshot().floor.layout.machines[0]).toEqual({ id: 'desk', kind: 'desk', x: 1, y: 1, w: 3, h: 2, name: 'Bug desk', defaults: { boardId: 'b1', type: 'fix' } });
    await engine.transfer('a', { machineId: 'desk' });
    await engine.transfer('b', { machineId: 'desk' });     // several can be created in a row: a desk has no capacity
    expect(where('a')).toBe('desk:zone');
    expect(statuses).toEqual([]);                       // being born at a desk sets nothing
    await run(8);
    expect(where('a')).toBe('z:zone');
    expect(where('b')).toBe('z:zone');
    await expect(engine.move('a', { machineId: 'desk' })).rejects.toThrow('A desk only holds the tickets created at it');
    await expect(engine.move('a', { x: 2, y: 2 })).rejects.toThrow('A desk only holds the tickets created at it');
    await engine.transfer('c', { machineId: 'desk' });
    await engine.giveBack('c');
    expect(where('c')).toBe('gone');
  });

  it('a ticket handed over without a target lands in the Inbound zone, created if the floor has none', async () => {
    await boot([belt('b1', 1, 1)]);
    await engine.transfer('a');
    const inbound = engine.snapshot().floor.layout.machines.find((m) => m.kind === 'zone' && m.inbound);
    expect(inbound).toMatchObject({ name: 'Inbound', status: '', release: 'manual' });
    expect(where('a')).toBe(`${inbound!.id}:zone`);
    expect(statuses).toEqual([]);                       // Inbound sets no status
    await engine.transfer('b');
    expect(engine.snapshot().floor.layout.machines.filter((m) => m.kind === 'zone' && m.inbound)).toHaveLength(1);
    expect(where('b')).toBe(`${inbound!.id}:zone`);
    expect(store.floor!.layout.machines).toHaveLength(2);   // the new zone was saved with the floor
    await run(2);
    expect(where('a')).toBe(`${inbound!.id}:zone`);     // it waits there until someone moves it
    await engine.move('a', { machineId: 'b1' });
    expect(where('a')).toBe('b1:belt');
  });

  it('a new floor starts with an Inbound zone, and a layout keeps at most one', async () => {
    engine = new FactoryEngine({
      store, now: () => clock, logger: { warn: () => {}, info: () => {} }, timing: BRISK, loadTicket: async (id) => infos.get(id) ?? null,
      setStatus: async () => {}, runner: { run: () => new Promise<StationRunResult>(() => {}) },
    });
    await engine.init();
    expect(engine.snapshot().floor.layout.machines).toMatchObject([{ kind: 'zone', name: 'Inbound', inbound: true }]);
    /* in the middle of the smallest floor the page shows, 300 tiles by 150 from 0,0: a new factory has room on every side */
    const inbound = engine.snapshot().floor.layout.machines[0]!;
    expect([inbound.x + inbound.w / 2, inbound.y + inbound.h / 2]).toEqual([150, 75]);
    const two = normaliseLayout({ w: 20, h: 20, machines: [{ ...zone('z1', 1, 1), inbound: true } as MachineSpec, { ...zone('z2', 6, 1), inbound: true } as MachineSpec] });
    expect(two.machines.map((m) => (m.kind === 'zone' ? m.inbound : null))).toEqual([true, false]);
  });

  it('a bridge lets two lines cross: each ticket goes straight across', async () => {
    const bridge: MachineSpec = { id: 'x', kind: 'bridge', x: 3, y: 3, w: 1, h: 1 };
    await boot([
      belt('w1', 1, 3), belt('w2', 2, 3), bridge, belt('e1', 4, 3), zone('east', 5, 3),
      belt('n1', 3, 1, 1), belt('n2', 3, 2, 1), belt('s1', 3, 4, 1), zone('south', 3, 5),
    ]);
    await engine.transfer('a', { machineId: 'w1' });
    await engine.transfer('b', { machineId: 'n1' });
    await run(6);
    expect(where('a')).toBe('east:zone');
    expect(where('b')).toBe('south:zone');
    await expect(engine.transfer('c', { machineId: 'x' })).rejects.toBeInstanceOf(FactoryError);
  });

  it('a fast belt carries a ticket twice as fast, and a bridge lane goes at the speed of the belt that feeds it', async () => {
    const fast = (id: string, x: number, y: number): MachineSpec => ({ ...belt(id, x, y), fast: true } as MachineSpec);
    /* two lines of the same length, side by side: plain belts above, fast ones below; each crosses a bridge fed by its own kind */
    await boot([
      belt('p0', 0, 1), belt('p1', 1, 1), { id: 'pb', kind: 'bridge', x: 2, y: 1, w: 1, h: 1 }, belt('p3', 3, 1), belt('p4', 4, 1), zone('slow', 5, 1, { w: 1, h: 1 }),
      fast('f0', 0, 4), fast('f1', 1, 4), { id: 'fb', kind: 'bridge', x: 2, y: 4, w: 1, h: 1 }, fast('f3', 3, 4), fast('f4', 4, 4), zone('quick', 5, 4, { w: 1, h: 1 }),
    ]);
    await engine.transfer('a', { machineId: 'p0' });
    await engine.transfer('b', { machineId: 'f0' });
    let slowAt = 0, quickAt = 0;
    for (let i = 1; i <= 80 && !(slowAt && quickAt); i++) {
      await run(0.1);
      if (!quickAt && where('b') === 'quick:zone') quickAt = i;
      if (!slowAt && where('a') === 'slow:zone') slowAt = i;
    }
    expect(quickAt).toBeGreaterThan(0);
    expect(slowAt).toBeGreaterThan(quickAt);
    expect(slowAt / quickAt).toBeGreaterThan(1.7);            // twice as fast, give or take a tick
    expect(slowAt / quickAt).toBeLessThan(2.3);
    /* the flag is kept on belts, and on nothing else */
    const saved = store.floor!.layout.machines;
    expect(saved.filter((m) => (m as { fast?: boolean }).fast).map((m) => m.id)).toEqual(['f0', 'f1', 'f3', 'f4']);
    expect(normaliseLayout({ w: 9, h: 9, machines: [{ ...belt('x', 0, 0), fast: 'yes' } as unknown as MachineSpec, { ...zone('z', 3, 3), fast: true } as unknown as MachineSpec] }).machines.some((m) => 'fast' in m && m.kind === 'belt')).toBe(false);
  });

  it('a bridge has no direction of its own: a ticket crosses it the way it arrives, west and north as well', async () => {
    const bridge: MachineSpec = { id: 'x', kind: 'bridge', x: 5, y: 5, w: 1, h: 1 };
    await boot([
      belt('e1', 7, 5, 2), belt('e2', 6, 5, 2), bridge, belt('w1', 4, 5, 2), zone('west', 2, 5),
      belt('s1', 5, 7, 3), belt('s2', 5, 6, 3), belt('n1', 5, 4, 3), zone('north', 5, 2),
    ]);
    await engine.transfer('a', { machineId: 'e1' });
    await engine.transfer('b', { machineId: 's1' });
    await run(6);
    expect([where('a'), where('b')]).toEqual(['west:zone', 'north:zone']);
  });

  it('an arm can drop on a bridge: the ticket crosses the way the arm points', async () => {
    const bridge: MachineSpec = { id: 'x', kind: 'bridge', x: 4, y: 5, w: 1, h: 1 };
    await boot([
      zone('in', 6, 5, { release: 'auto' }), arm('a1', 5, 5, 2), bridge, belt('w1', 3, 5, 2), zone('west', 1, 5),
      belt('n1', 4, 4, 1), belt('s1', 4, 6, 1), zone('south', 4, 7),
    ]);
    await engine.transfer('a', { machineId: 'in' });
    await engine.transfer('b', { machineId: 'n1' });
    await run(6);
    expect([where('a'), where('b')]).toEqual(['west:zone', 'south:zone']);
  });

  it('a bridge lane waits when the tile after it is taken, without blocking the other lane', async () => {
    const bridge: MachineSpec = { id: 'x', kind: 'bridge', x: 3, y: 3, w: 1, h: 1 };
    await boot([belt('w2', 2, 3), bridge, belt('e1', 4, 3), belt('n2', 3, 2, 1), belt('s1', 3, 4, 1), zone('south', 3, 5)]);   // e1 leads nowhere
    await engine.transfer('c', { machineId: 'e1' });
    await engine.transfer('a', { machineId: 'w2' });
    await engine.transfer('b', { machineId: 'n2' });
    await run(4);
    expect(where('c')).toBe('e1:belt');
    expect(where('a')).toBe('x:belt');                  // held on the bridge, east-west lane
    expect(where('b')).toBe('south:zone');              // the north-south lane kept moving
  });

  it('the floor has no edge: machines can sit at negative coordinates', async () => {
    await boot([belt('b1', -3, -2), belt('b2', -2, -2), zone('z', -1, -3)]);
    await engine.transfer('a', { machineId: 'b1' });
    await run(3);
    expect(where('a')).toBe('z:zone');
    await engine.move('a', { x: -40, y: 12 });
    expect(engine.snapshot().tickets[0]).toMatchObject({ phase: 'loose', x: -40, y: 12 });
  });

  it('a belt tile holds one ticket: a full one makes the tile behind it wait', async () => {
    await boot([belt('b1', 1, 1), belt('b2', 2, 1), belt('b3', 3, 1)]);   // b3 leads nowhere
    await engine.transfer('a', { machineId: 'b3' });
    await engine.transfer('b', { machineId: 'b1' });
    await run(3);
    expect(where('a')).toBe('b3:belt');
    expect(where('b')).toBe('b2:belt');
    await expect(engine.move('c', { machineId: 'b2' })).rejects.toBeInstanceOf(FactoryError);
  });

  it('a filtered arm takes what matches; the unfiltered one takes the rest', async () => {
    await boot([
      zone('in', 1, 3, { release: 'auto' }),
      arm('fix', 3, 3, 0, 'type', ['fix']), zone('fixes', 4, 3),
      arm('rest', 1, 5, 1), zone('others', 1, 6),
    ]);
    infos.set('a', info('a', { type: 'fix' }));
    await engine.transfer('a', { machineId: 'in' });
    await engine.transfer('b', { machineId: 'in' });
    await run(4);
    expect(where('a')).toBe('fixes:zone');
    expect(where('b')).toBe('others:zone');
  });

  it('a manual zone keeps a ticket until it is released', async () => {
    await boot([zone('backlog', 1, 1), arm('out', 3, 1, 0), zone('next', 4, 1)]);
    await engine.transfer('a', { machineId: 'backlog' });
    await run(2);
    expect(where('a')).toBe('backlog:zone');
    await engine.release('a');
    await run(2);
    expect(where('a')).toBe('next:zone');
  });

  it('runs a station, then routes the ticket by the outcome of the run', async () => {
    await boot([
      station('review', 1, 3, { outcomes: ['OK', 'fix-first'] }),
      arm('ok', 4, 4, 0), zone('done', 5, 4),
      arm('back', 2, 6, 1, 'outcome', ['fix-first']), zone('rework', 1, 7),
    ]);
    await engine.transfer('a', { machineId: 'review' });
    await run(0.3);
    expect(where('a')).toBe('review:running');
    expect(pending).toHaveLength(1);
    pending[0]!.resolve({ status: 'completed', outcome: 'fix-first', executionId: 'exec-1', error: null });
    await run(2);
    expect(where('a')).toBe('rework:zone');
    const runs = [...store.runs.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ticketId: 'a', machineId: 'review', status: 'completed', outcome: 'fix-first', executionId: 'exec-1' });
  });

  it('a failed run and an agent question both wait for a human, who can run the station again', async () => {
    await boot([station('spec', 1, 1)]);
    await engine.transfer('a', { machineId: 'spec' });
    await run(0.3);
    pending[0]!.resolve({ status: 'failed', outcome: '', executionId: null, error: 'boom' });
    await run(0.3);
    expect(where('a')).toBe('spec:failed');
    expect(engine.snapshot().tickets[0]?.note).toBe('boom');
    await engine.retry('a');
    await run(0.3);
    expect(pending).toHaveLength(2);
    pending[1]!.resolve({ status: 'question', outcome: '', executionId: 'e2', error: null });
    await run(0.3);
    expect(where('a')).toBe('spec:question');
    await expect(engine.release('a')).rejects.toBeInstanceOf(FactoryError);
  });

  it('an unanswered question leaves only by an arm filtered on outcome "question", never by the unfiltered one', async () => {
    // Why: a ticket the agent could not handle must not carry on down the normal path as if it had been triaged.
    await boot([
      station('triage', 1, 3, { outcomes: ['bug', 'feature'] }),
      arm('else', 4, 4, 0), zone('next', 5, 4),
      arm('ask', 2, 6, 1, 'outcome', ['question']), zone('awaiting', 1, 7),
    ]);
    await engine.transfer('a', { machineId: 'triage' });
    await engine.transfer('b', { machineId: 'triage' });
    await run(0.3);
    pending[0]!.resolve({ status: 'question', outcome: '', executionId: 'e1', error: null });
    pending[1]!.resolve({ status: 'completed', outcome: 'bug', executionId: 'e2', error: null });
    await run(3);
    expect(where('a')).toBe('awaiting:zone');
    expect(engine.snapshot().tickets.find((t) => t.ticketId === 'a')?.outcome).toBe('question');
    expect(where('b')).toBe('next:zone');
  });

  it('without an arm for questions, an unanswered ticket stays in its station, even next to an unfiltered arm', async () => {
    await boot([station('triage', 1, 3, { outcomes: ['bug', 'feature'] }), arm('else', 4, 4, 0), zone('next', 5, 4)]);
    await engine.transfer('a', { machineId: 'triage' });
    await run(0.3);
    pending[0]!.resolve({ status: 'question', outcome: '', executionId: 'e1', error: null });
    await run(3);
    expect(where('a')).toBe('triage:question');
    await engine.retry('a');
    expect(engine.snapshot().tickets[0]?.outcome).toBe('');
  });

  it('a gate waits for a decision, and only accepts one of its outcomes', async () => {
    await boot([
      station('gate', 1, 3, { exec: 'human_gate', outcomes: ['approve', 'reject'] }),
      arm('fwd', 4, 4, 0), zone('next', 5, 4),
      arm('rej', 2, 2, 3, 'outcome', ['reject']), zone('back', 1, 0),
    ]);
    await engine.transfer('a', { machineId: 'gate' });
    await run(1);
    expect(where('a')).toBe('gate:review');
    expect(pending).toHaveLength(0);                    // nothing is run at a gate
    await expect(engine.resolveGate('a', 'maybe')).rejects.toBeInstanceOf(FactoryError);
    await engine.resolveGate('a', 'reject');
    await run(2);
    expect(where('a')).toBe('back:zone');
    expect([...store.runs.values()][0]).toMatchObject({ executor: 'human_gate', status: 'completed', outcome: 'reject' });
  });

  it('a native station sets a status and lets the ticket through', async () => {
    await boot([station('doing', 1, 1, { exec: 'native', sets: 'doing' }), arm('o', 3, 1, 0), zone('z', 4, 1)]);
    await engine.transfer('a', { machineId: 'doing' });
    await run(2);
    expect(statuses).toEqual([['a', 'doing']]);
    expect(where('a')).toBe('z:zone');
  });

  it('a ticket rests a second in a station before an arm takes it out, however fast the station was', async () => {
    await boot([belt('b1', 1, 1), arm('in', 2, 1, 0), station('prio', 3, 1, { exec: 'native', sets: 'doing', w: 2, h: 2 } as Partial<StationSpec>), arm('out', 5, 1, 0), zone('z', 6, 1)], 30, 12, 'real');
    await engine.transfer('a', { machineId: 'b1' });
    /* follow the ticket tick by tick: how long it is seen in the station, done and waiting */
    let seen = 0, guard = 0;
    while (where('a') !== 'z:zone' && guard++ < 200) { await run(0.1); if (where('a') === 'prio:out') seen++; }
    expect(where('a')).toBe('z:zone');
    expect(seen).toBeGreaterThanOrEqual(10);   // at least a second, in ticks of a tenth
    expect(statuses).toEqual([['a', 'doing']]);
  });

  it('says which way each arm is swinging, and how long a swing takes, so the page can carry the motion on', async () => {
    await boot([zone('in', 1, 1, { release: 'auto' }), arm('a1', 3, 1, 0), zone('z', 4, 1)], 30, 12, 'real');
    const arm1 = () => engine.snapshot().arms[0]!;
    expect(arm1()).toMatchObject({ id: 'a1', p: 0, state: 'rest', carrying: null });
    expect(engine.snapshot().armSwing).toBeGreaterThanOrEqual(1);
    await engine.transfer('a', { machineId: 'in' });
    await run(0.5);
    expect(arm1()).toMatchObject({ state: 'carry', carrying: 'a' });
    expect(arm1().p).toBeGreaterThan(0.1); expect(arm1().p).toBeLessThan(0.9);   // half a second in, the half turn is under way, not done
    await run(1.2);
    expect(where('a')).toBe('z:zone');
    expect(arm1()).toMatchObject({ state: 'back', carrying: null });
    await run(1.5);
    expect(arm1()).toMatchObject({ p: 0, state: 'rest' });
  });

  it('routes on any condition of an arm, and all of them together', async () => {
    const when = (id: string, x: number, conditions: ArmCondition[]): MachineSpec => ({ id, kind: 'arm', x, y: 2, w: 1, h: 1, dir: 1, when: conditions });
    await boot([
      zone('in', 1, 0, { release: 'auto', w: 6, h: 2 } as Partial<MachineSpec>),
      when('big', 1, [{ field: 'complexity', op: 'gte', values: ['8'] }]), zone('split', 1, 3),
      when('hot', 3, [{ field: 'priority', op: 'gte', values: ['high'] }, { field: 'board', op: 'is', values: ['core'] }]), zone('now', 3, 3),
      when('rest', 5, []), zone('later', 5, 3),
    ]);
    infos.set('a', info('a', { complexity: '13', priority: 'urgent', boardId: 'core' }));    // big wins: it is asked first
    infos.set('b', info('b', { complexity: '3', priority: 'urgent', boardId: 'core' }));
    infos.set('c', info('c', { complexity: null, priority: 'urgent', boardId: 'support' })); // urgent, but not on the board asked for
    for (const id of ['a', 'b', 'c']) await engine.transfer(id, { machineId: 'in' });
    await run(8);
    expect([where('a'), where('b'), where('c')]).toEqual(['split:zone', 'now:zone', 'later:zone']);
  });

  it('a floor saved with the older single filter keeps routing, and is rewritten as conditions', async () => {
    await boot([zone('in', 1, 1, { release: 'auto' }), arm('fixes', 3, 1, 0, 'type', ['fix']), zone('z', 4, 1)]);
    const saved = store.floor!.layout.machines.find((m) => m.id === 'fixes') as { when?: ArmCondition[]; filter?: unknown };
    expect(saved.when).toEqual([{ field: 'type', op: 'is', values: ['fix'] }]);
    expect(saved.filter).toBeUndefined();
    infos.set('a', info('a', { type: 'fix' }));
    await engine.transfer('a', { machineId: 'in' }); await engine.transfer('b', { machineId: 'in' });
    await run(3);
    expect([where('a'), where('b')]).toEqual(['z:zone', 'in:zone']);
  });

  it('the exit sets done and hands the ticket back to plain Fleex', async () => {
    await boot([belt('b1', 1, 1), exit('out', 2, 1)]);
    await engine.transfer('a', { machineId: 'b1' });
    await run(1);
    expect(where('a')).toBe('gone');
    expect(statuses).toEqual([['a', 'done']]);
    expect(store.tickets.has('a')).toBe(false);
    expect(engine.isManaged('a')).toBe(false);
  });

  it('shows what the page needs to tell tickets apart, and re-reads one on demand', async () => {
    await boot([zone('in', 1, 1)]);
    infos.set('a', info('a', { boardId: 'b7', complexity: '5', favorite: false }));
    await engine.transfer('a', { machineId: 'in' });
    const seen = () => engine.snapshot().tickets[0]!;
    expect(seen().info).toMatchObject({ boardId: 'b7', complexity: '5', favorite: false });
    expect(seen().handedAt).toBe(new Date(clock).toISOString());
    infos.set('a', info('a', { boardId: 'b7', complexity: '5', favorite: true }));
    await engine.refreshInfo('a');
    expect(seen().info?.favorite).toBe(true);
    await expect(engine.refreshInfo('nope')).rejects.toBeInstanceOf(FactoryError);
  });

  it('a shipment leaves a run row that spans hand-over to exit', async () => {
    await boot([belt('b1', 1, 1), exit('out', 2, 1)]);
    const handedOver = new Date(clock).toISOString();
    await engine.transfer('a', { machineId: 'b1' });
    await run(1);
    const rows = [...store.runs.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticketId: 'a', machineId: 'out', executor: 'exit', status: 'completed', outcome: 'shipped', startedAt: handedOver });
    expect(new Date(rows[0]!.finishedAt!).getTime()).toBeGreaterThan(new Date(handedOver).getTime());
  });

  it('a full station takes nothing more', async () => {
    await boot([zone('in', 1, 1, { release: 'auto' }), arm('feed', 3, 1, 0), station('s', 4, 0, { cap: 1 })]);
    await engine.transfer('a', { machineId: 'in' });
    await engine.transfer('b', { machineId: 'in' });
    await run(3);
    expect(where('a')).toBe('s:running');
    expect(where('b')).toMatch(/^(in:zone|feed:arm)$/);
  });

  it('stops starting runs at the hourly limit and at the concurrency limit', async () => {
    await boot([station('s', 1, 1)]);
    await engine.setSettings({ maxConcurrentRuns: 1, maxRunsPerHour: 2 });
    for (const id of ['a', 'b', 'c']) await engine.transfer(id, { machineId: 's' });
    await run(0.5);
    expect(pending).toHaveLength(1);                    // one at a time
    expect(engine.snapshot().tickets.find((t) => t.ticketId === 'b')?.note).toContain('already in flight');
    pending[0]!.resolve({ status: 'completed', outcome: 'ok', executionId: null, error: null });
    await run(0.5);
    expect(pending).toHaveLength(2);
    pending[1]!.resolve({ status: 'completed', outcome: 'ok', executionId: null, error: null });
    await run(0.5);
    expect(pending).toHaveLength(2);                    // the hour's budget is spent
    expect(engine.snapshot().tickets.find((t) => t.ticketId === 'c')?.note).toContain('Limit of 2 runs per hour');
    clock += 3_600_001;
    await run(0.5);
    expect(pending).toHaveLength(3);
  });

  it('ignores the result of a run whose ticket was moved away by hand', async () => {
    await boot([station('s', 1, 1), zone('z', 6, 1)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.3);
    await engine.move('a', { machineId: 'z' });
    pending[0]!.resolve({ status: 'completed', outcome: 'ok', executionId: 'e', error: null });
    await run(0.3);
    expect(where('a')).toBe('z:zone');
    expect([...store.runs.values()][0]?.status).toBe('interrupted');
  });

  it('after a restart, a ticket whose run was in flight waits for a human', async () => {
    await boot([station('s', 1, 1)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.3);
    await engine.flush();
    const layout = store.floor!.layout;
    engine = new FactoryEngine({
      store, now: () => clock, logger: { warn: () => {}, info: () => {} }, timing: BRISK, loadTicket: async (id) => infos.get(id) ?? null,
      setStatus: async () => {}, runner: { run: () => new Promise<StationRunResult>(() => {}) },
    });
    await engine.init();
    expect(engine.snapshot().floor.layout).toEqual(layout);
    expect(where('a')).toBe('s:failed');
    expect([...store.runs.values()][0]?.status).toBe('interrupted');
  });

  it('removing the machine a ticket stands on leaves it on the floor; giving it back forgets it', async () => {
    await boot([zone('z', 1, 1)]);
    await engine.transfer('a', { machineId: 'z' });
    await engine.setLayout({ w: 30, h: 12, machines: [] });
    expect(where('a')).toBe('floor:loose');
    await engine.giveBack('a');
    expect(where('a')).toBe('gone');
    expect(store.tickets.size).toBe(0);
    expect(statuses).toEqual([]);                       // giving back never touches the ticket itself
  });

  it('lets go of a ticket that was deleted or archived elsewhere', async () => {
    await boot([zone('z', 1, 1)]);
    await engine.transfer('a', { machineId: 'z' });
    infos.delete('a');
    await engine.refreshInfos();
    expect(where('a')).toBe('gone');
  });

  it('never runs two sweeps at once, and reads a few tickets at a time', async () => {
    await boot([zone('z', 1, 1, { cap: 50 })]);
    for (let i = 0; i < 20; i++) { infos.set(`t${i}`, info(`t${i}`)); await engine.transfer(`t${i}`, { machineId: 'z' }); }
    let inFlight = 0, most = 0, reads = 0;
    const gate: (() => void)[] = [];
    (engine as unknown as { deps: { loadTicket: (id: string) => Promise<FactoryTicketInfo | null> } }).deps.loadTicket = async (id) => {
      reads++; inFlight++; most = Math.max(most, inFlight);
      await new Promise<void>((r) => gate.push(r));
      inFlight--; return infos.get(id) ?? null;
    };
    const first = engine.refreshInfos(), second = engine.refreshInfos();
    expect(second).toBe(first);
    while (reads < 20 || gate.length) { await settle(); gate.splice(0).forEach((r) => r()); await settle(); }
    await first;
    expect(reads).toBe(20);
    expect(most).toBe(8);
  });
});

describe('teleporters', () => {
  const port = (id: string, x: number, y: number, role: 'departure' | 'arrival', to?: string): MachineSpec => ({ id, kind: 'teleporter', x, y, w: 1, h: 1, name: id, role, ...(to ? { to } : {}) });
  /* a zone, an arm into a departure; far away its arrival, an arm out of it onto a belt */
  const line = (extra: MachineSpec[] = []) => [zone('z', 0, 0), arm('a1', 2, 0, 0), port('go', 3, 0, 'departure', 'land'), port('land', 10, 5, 'arrival'), arm('a2', 11, 5, 0), belt('b', 12, 5), ...extra];
  beforeEach(() => { for (const id of ['t1', 't2', 't3', 'held']) infos.set(id, info(id)); });

  it('a ticket dropped in a departure comes out of its arrival, where an arm takes it', async () => {
    await boot(line());
    await engine.transfer('t1', { machineId: 'z' });
    await engine.release('t1');
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) { await run(0.1); seen.add(where('t1')); }
    expect([...seen]).toEqual(expect.arrayContaining(['a1:arm', 'land:port', 'a2:arm', 'b:belt']));
    expect(statuses).toEqual([]);                                   // a jump changes nothing on the ticket
    expect(store.runs.size).toBe(0);                                // and is not a run
  });

  it('stays in view a moment in the departure, then in the arrival, when the floor runs at its own pace', async () => {
    await boot(line(), 30, 12, { armSwing: 0.2, stationRestMs: 0, teleportRestMs: 800 });
    await engine.transfer('t1', { machineId: 'go' });
    await run(0.7);
    expect(where('t1')).toBe('go:port');
    await run(0.2);
    expect(where('t1')).toBe('land:port');
    await run(0.6);
    expect(where('t1')).toBe('land:port');                          // the arm waits for it to have landed
    await run(0.2);
    expect(where('t1')).toBe('a2:arm');
  });

  it('holds one ticket: a second one waits in the arm that brings it', async () => {
    await boot([zone('z', 0, 0), arm('a1', 2, 0, 0), port('go', 3, 0, 'departure')]);       // no destination: it keeps what it is given
    await engine.transfer('t1', { machineId: 'z' }); await engine.transfer('t2', { machineId: 'z' });
    await engine.release('t1'); await engine.release('t2');
    await run(3);
    expect(where('t1')).toBe('go:port');
    expect(where('t2')).toBe('z:zone');                             // the arm does not pick what it could not put down
    await expect(engine.move('t2', { machineId: 'go' })).rejects.toThrow(/already holds a ticket/);
  });

  it('nothing on the floor enters an arrival: not an arm, not a belt, not a hand', async () => {
    await boot([zone('z', 0, 0), arm('a1', 2, 0, 0), port('land', 3, 0, 'arrival'), belt('b1', 0, 5), belt('b2', 1, 5), port('land2', 2, 5, 'arrival')]);
    await engine.transfer('t1', { machineId: 'z' }); await engine.release('t1');
    await engine.transfer('t2', { machineId: 'b1' });
    await run(3);
    expect(where('t1')).toBe('z:zone');
    expect(where('t2')).toBe('b2:belt');                            // at the end of its belt, and no further
    await expect(engine.move('t1', { machineId: 'land' })).rejects.toThrow(/Nothing can be dropped on an arrival/);
    await expect(engine.transfer('t3', { machineId: 'land' })).rejects.toThrow();
  });

  it('a belt feeds a departure as it feeds a station', async () => {
    await boot([belt('b1', 0, 0), belt('b2', 1, 0), port('go', 2, 0, 'departure', 'land'), port('land', 8, 8, 'arrival')]);
    await engine.transfer('t1', { machineId: 'b1' });
    await run(3);
    expect(where('t1')).toBe('land:port');
  });

  it('several departures lead to one arrival: their tickets wait where they are, and go in the order they came', async () => {
    await boot([port('one', 0, 0, 'departure', 'land'), port('two', 0, 2, 'departure', 'land'), port('three', 0, 4, 'departure', 'land'), port('land', 10, 5, 'arrival'), arm('a2', 11, 5, 0), zone('out', 12, 5)], 30, 12, { armSwing: 0.2, stationRestMs: 0, teleportRestMs: 0 });
    /* nothing is sent while the arrival holds a ticket: `three` first, then `one`, then `two` */
    await engine.transfer('held', { machineId: 'one' });
    await run(0.1);
    expect(where('held')).toBe('land:port');
    /* the arm is kept from emptying it: its zone is replaced by nothing it can drop on */
    await engine.setLayout({ w: 30, h: 12, machines: [port('one', 0, 0, 'departure', 'land'), port('two', 0, 2, 'departure', 'land'), port('three', 0, 4, 'departure', 'land'), port('land', 10, 5, 'arrival'), arm('a2', 11, 5, 0), port('wall', 12, 5, 'arrival')] });
    expect(where('held')).toBe('land:port');
    await engine.transfer('c', { machineId: 'three' }); clock += 1000;
    await engine.transfer('a', { machineId: 'one' }); clock += 1000;
    await engine.transfer('b', { machineId: 'two' });
    await run(1);
    expect([where('a'), where('b'), where('c')]).toEqual(['one:port', 'two:port', 'three:port']);
    /* the arrival is emptied by hand, three times: each time the one that waited longest comes */
    const order: string[] = [];
    for (let i = 0; i < 3; i++) {
      await engine.giveBack(engine.snapshot().tickets.find((t) => t.machineId === 'land')!.ticketId);
      await run(0.2);
      order.push(engine.snapshot().tickets.find((t) => t.machineId === 'land')!.ticketId);
    }
    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('a departure with no arrival to go to keeps its ticket; one whose arrival is removed loses its destination', async () => {
    await boot([port('go', 0, 0, 'departure', 'land'), port('land', 5, 0, 'arrival')]);
    await engine.setLayout({ w: 30, h: 12, machines: [port('go', 0, 0, 'departure', 'land')] });
    expect((store.floor!.layout.machines[0] as { to?: string }).to).toBeUndefined();
    await engine.transfer('t1', { machineId: 'go' });
    await run(2);
    expect(where('t1')).toBe('go:port');
  });

  it('comes back as it was after a restart, and a ticket in a teleporter that is removed lies on the floor', async () => {
    await boot([port('go', 0, 0, 'departure'), port('land', 5, 0, 'arrival')]);
    await engine.transfer('t1', { machineId: 'go' });
    await engine.flush();
    await boot([port('go', 0, 0, 'departure'), port('land', 5, 0, 'arrival')]);
    expect(where('t1')).toBe('go:port');
    await expect(engine.transfer('t2', { machineId: 'go' })).rejects.toThrow(/already holds/);
    await engine.setLayout({ w: 30, h: 12, machines: [port('land', 5, 0, 'arrival')] });
    expect(where('t1')).toBe('floor:loose');
  });
});

describe('normaliseLayout', () => {
  it('keeps of a teleporter what makes one: a role, a name, a colour, and for a departure an arrival of this floor', () => {
    const out = normaliseLayout({ w: 20, h: 20, machines: [
      { id: 'd', kind: 'teleporter', x: 0, y: 0, w: 3, h: 3, role: 'departure', to: 'a', name: '  goto bugfix  ', color: '#F472B6' } as MachineSpec,
      { id: 'a', kind: 'teleporter', x: 5, y: 0, w: 1, h: 1, role: 'arrival', to: 'd', color: 'pink' } as MachineSpec,
      { id: 'x', kind: 'teleporter', x: 8, y: 0, w: 1, h: 1, role: 'sideways', to: 'nowhere' } as unknown as MachineSpec,
      { id: 'y', kind: 'teleporter', x: 10, y: 0, w: 1, h: 1, role: 'departure', to: 'd' } as MachineSpec,
    ] }).machines as (MachineSpec & { role?: string; to?: string; color?: string })[];
    expect(out[0]).toMatchObject({ w: 1, h: 1, role: 'departure', to: 'a', name: 'goto bugfix', color: '#f472b6' });
    expect(out[1]).toMatchObject({ role: 'arrival' }); expect(out[1]!.to).toBeUndefined(); expect(out[1]!.color).toBeUndefined();
    expect(out[2]).toMatchObject({ role: 'departure' }); expect(out[2]!.to).toBeUndefined();   // an unknown role is a departure, and it leads nowhere
    expect(out[3]!.to).toBeUndefined();                                                        // a departure cannot lead to another departure
  });

  it('keeps the model chosen on an agent or skill station, which runs it, and drops it elsewhere', () => {
    const out = normaliseLayout({ w: 30, h: 10, machines: [
      station('a', 0, 0, { exec: 'agent', model: ' claude-haiku-5-5 ' }), station('s', 6, 0, { exec: 'skill', ref: 'review', model: 'claude-haiku-5-5' }),
      station('p', 12, 0, { exec: 'panel', model: 'claude-haiku-5-5' }), station('e', 18, 0, { exec: 'skill', model: '  ' }),
    ] }).machines as StationSpec[];
    expect(out.map((m) => m.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5', undefined, undefined]);
  });

  it('refuses overlaps and duplicate ids, and records how far the floor extends', () => {
    expect(() => normaliseLayout({ w: 10, h: 10, machines: [belt('a', 1, 1), belt('b', 1, 1)] })).toThrow(/overlap/);
    expect(normaliseLayout({ w: 0, h: 0, machines: [station('s', -8, 8), belt('a', 30, 2)] })).toMatchObject({ w: 39, h: 9 });
    expect(() => normaliseLayout({ w: 10, h: 10, machines: [belt('a', 1, 1), belt('a', 2, 1)] })).toThrow(/unique id/);
  });

  it('keeps the colour an arm was given when it is one, on arms only', () => {
    const out = normaliseLayout({ w: 20, h: 20, machines: [
      { ...arm('a', 1, 1, 0), color: '#EF4444' } as MachineSpec, { ...arm('b', 3, 1, 0), color: 'red' } as MachineSpec, { ...arm('c', 5, 1, 0), color: 12 } as unknown as MachineSpec, arm('d', 7, 1, 0),
    ] });
    expect(out.machines.map((m) => (m as { color?: string }).color)).toEqual(['#ef4444', undefined, undefined, undefined]);
    expect(out.machines.filter((m) => 'color' in m).map((m) => m.id)).toEqual(['a']);
  });

  it('gives each kind its footprint and a station at least one outcome', () => {
    const out = normaliseLayout({ w: 20, h: 20, machines: [{ ...station('s', 1, 1), w: 9, h: 9, outcomes: [] } as MachineSpec, { ...station('n', 12, 1, { exec: 'native' }), w: 9 } as MachineSpec] });
    expect(out.machines.map((m) => [m.w, m.h])).toEqual([[8, 6], [2, 2]]);          // a machine is 3 by 3 to 8 by 6, a status station 2 by 2
    expect(out.version).toBe(LAYOUT_VERSION);
    expect((out.machines[0] as StationSpec).outcomes).toEqual(['ok']);
  });
});

const ok: StationRunResult = { status: 'completed', outcome: 'ok', executionId: null, error: null };
const note = (ticketId: string) => engine.snapshot().tickets.find((t) => t.ticketId === ticketId)?.note ?? '';

describe('a station works on as many tickets as it has places', () => {
  it('runs no more than its capacity at once, and what cannot enter stays upstream', async () => {
    await boot([zone('in', 1, 1, { release: 'auto' }), arm('feed', 3, 1, 0), station('s', 4, 0, { cap: 2 })]);
    for (const id of ['a', 'b', 'c']) await engine.transfer(id, { machineId: 'in' });
    await run(6);
    expect([where('a'), where('b')]).toEqual(['s:running', 's:running']);
    expect(where('c')).toMatch(/^(in:zone|feed:arm)$/);
    expect(pending).toHaveLength(2);
  });

  it('a ticket set aside frees its place: a question or a failure no longer blocks the station', async () => {
    await boot([zone('in', 1, 1, { release: 'auto' }), arm('feed', 3, 1, 0), station('s', 4, 0, { cap: 1 })]);
    await engine.transfer('a', { machineId: 'in' });
    await engine.transfer('b', { machineId: 'in' });
    await run(3);
    pending[0]!.resolve({ status: 'question', outcome: '', executionId: null, error: null });
    await run(4);
    expect(where('a')).toBe('s:question');
    expect(where('b')).toBe('s:running');
  });

  it('stops taking tickets in when what is done piles up as high as it is big', async () => {
    await boot([zone('in', 1, 1, { release: 'auto' }), arm('feed', 3, 1, 0), station('s', 4, 0, { cap: 1 })]);   // nothing takes tickets out of the station
    await engine.transfer('a', { machineId: 'in' });
    await engine.transfer('b', { machineId: 'in' });
    await run(3);
    pending[0]!.resolve(ok);
    await run(4);
    expect(where('a')).toBe('s:out');
    expect(where('b')).toMatch(/^(in:zone|feed:arm)$/);
  });
});

describe('setting a ticket aside, and putting it back', () => {
  it('stops the run in progress, keeps the ticket in its station and ignores what the run returns', async () => {
    await boot([station('s', 1, 1), arm('o', 4, 2, 0), zone('next', 5, 2)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.3);
    pending[0]!.started('exec-1');
    await engine.setAside('a');
    expect(where('a')).toBe('s:aside');
    expect(cancelled).toEqual(['exec-1']);
    expect([...store.runs.values()][0]?.status).toBe('interrupted');
    pending[0]!.resolve(ok);
    await run(2);
    expect(where('a')).toBe('s:aside');                 // the arm leaves it alone, the late result changes nothing
    expect(note('a')).toContain('stopped');
  });

  it('leaves the station by the arm of the outcome it is put back as', async () => {
    await boot([station('triage', 1, 3, { outcomes: ['bug', 'feature'] }), arm('b', 4, 3, 0, 'outcome', ['bug']), zone('bugs', 5, 3), arm('f', 4, 5, 0, 'outcome', ['feature']), zone('features', 5, 5)]);
    await engine.transfer('a', { machineId: 'triage' });
    await run(0.3);
    await engine.setAside('a');
    await expect(engine.putBack('a', 'as', 'nope')).rejects.toThrow(/not an outcome/);
    await engine.putBack('a', 'as', 'feature');
    await run(3);
    expect(where('a')).toBe('features:zone');
  });

  it('runs the station again when put back for another go, after a failure as after a stop', async () => {
    await boot([station('s', 1, 1)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.3);
    pending[0]!.resolve({ status: 'failed', outcome: '', executionId: null, error: 'boom' });
    await run(0.3);
    expect(where('a')).toBe('s:failed');
    await engine.putBack('a', 'again');
    await run(0.3);
    expect(where('a')).toBe('s:running');
    expect(pending).toHaveLength(2);
    await engine.setAside('a');
    await engine.retry('a');
    await run(0.3);
    expect(pending).toHaveLength(3);
  });

  it('refuses what is not in a station that runs something, and what is not set aside', async () => {
    await boot([station('gate', 1, 1, { exec: 'human_gate', outcomes: ['approve', 'reject'] }), zone('z', 6, 1), station('s', 9, 1)]);
    await engine.transfer('a', { machineId: 'gate' });
    await engine.transfer('b', { machineId: 'z' });
    await engine.transfer('c', { machineId: 's' });
    await expect(engine.setAside('a')).rejects.toThrow(FactoryError);   // a gate only waits for a human: nothing to set aside
    await expect(engine.setAside('b')).rejects.toThrow(FactoryError);
    await expect(engine.putBack('c', 'again')).rejects.toThrow(/not set aside/);
  });
});

describe('what someone does from the ticket thread', () => {
  it('sets a ticket aside when something is launched on it by hand, and stops the run of its station', async () => {
    await boot([station('s', 1, 1), arm('o', 4, 2, 0), zone('next', 5, 2)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.3);
    pending[0]!.started('exec-1');
    expect(await engine.launchedByHand('a')).toBe(true);
    expect(where('a')).toBe('s:aside');
    expect(cancelled).toEqual(['exec-1']);
    expect(note('a')).toContain('by hand');
    expect(await engine.launchedByHand('a')).toBe(false);          // already set aside: nothing more to do
  });

  it('leaves alone a ticket no station is working on', async () => {
    await boot([station('gate', 1, 1, { exec: 'human_gate', outcomes: ['approve', 'reject'] }), zone('z', 6, 1)]);
    await engine.transfer('a', { machineId: 'gate' });
    await engine.transfer('b', { machineId: 'z' });
    expect(await engine.launchedByHand('a')).toBe(false);
    expect(await engine.launchedByHand('b')).toBe(false);
    expect(await engine.launchedByHand('nope')).toBe(false);
    expect(where('a')).toBe('gate:review');
    expect(where('b')).toBe('z:zone');
  });

  it('gives a ticket back to the station that asked a question once it is answered, and only then', async () => {
    await boot([station('s', 1, 1)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.3);
    expect(await engine.answered('a')).toBe(false);                 // it runs: a comment is not an answer
    pending[0]!.resolve({ status: 'question', outcome: '', executionId: null, error: null });
    await run(0.3);
    expect(where('a')).toBe('s:question');
    expect(await engine.answered('a')).toBe(true);
    await run(0.3);
    expect(where('a')).toBe('s:running');
    expect(pending).toHaveLength(2);
  });
});

describe('a station has a switch', () => {
  it('off, it takes tickets in and starts nothing; on again, it starts them', async () => {
    await boot([station('s', 1, 1)]);
    await engine.setPower('s', false);
    await engine.transfer('a', { machineId: 's' });
    await run(1);
    expect(where('a')).toBe('s:wait');
    expect(note('a')).toContain('switched off');
    expect(pending).toHaveLength(0);
    expect((store.floor!.layout.machines[0] as StationSpec).off).toBe(true);     // kept with the floor
    await engine.setPower('s', true);
    await run(0.3);
    expect(where('a')).toBe('s:running');
    expect((store.floor!.layout.machines[0] as StationSpec).off).toBeUndefined();
  });

  it('lets what already runs finish', async () => {
    await boot([station('s', 1, 1)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.3);
    await engine.setPower('s', false);
    pending[0]!.resolve(ok);
    await run(0.3);
    expect(where('a')).toBe('s:out');
  });

  it('exists only on a station that runs something, and survives a save of the layout only there', async () => {
    await boot([station('gate', 1, 1, { exec: 'human_gate', outcomes: ['approve', 'reject'] })]);
    await expect(engine.setPower('gate', false)).rejects.toThrow(/switch/);
    const out = normaliseLayout({ w: 20, h: 20, machines: [{ ...station('s', 1, 1), off: true } as MachineSpec, { ...station('g', 6, 1, { exec: 'human_gate' }), off: true } as MachineSpec] });
    expect(out.machines.map((m) => (m as StationSpec).off)).toEqual([true, undefined]);
  });
});

describe('a Set gantry over a belt', () => {
  const gantry = (id: string, x: number, y: number, set: SetOp[]): MachineSpec => ({ ...belt(id, x, y), set } as MachineSpec);
  const inc: SetOp = { field: 'tag', op: 'inc', value: 'passes' };
  const info1 = () => engine.snapshot().tickets.find((t) => t.ticketId === 'a')!.info!;

  it('changes the ticket that goes under it, in order, and lets it go on once that is written', async () => {
    await boot([belt('b1', 0, 0), gantry('g', 1, 0, [{ field: 'priority', value: 'high' }, { field: 'board', value: 'bugfix' }, { field: 'tag', op: 'set', value: 'type:major' }, inc]), belt('b2', 2, 0), belt('b3', 3, 0)]);
    await engine.transfer('a', { machineId: 'b1' });
    await run(3);
    expect(where('a')).toBe('b3:belt');
    expect(changes).toEqual([['a', { fields: { priority: 'high', boardId: 'bugfix', tags: ['type:major', 'passes:1'] } }]]);
    expect(info1()).toMatchObject({ priority: 'high', boardId: 'bugfix', tags: ['type:major', 'passes:1'] });
    expect(statuses).toEqual([]);                                       // nothing but what was asked
  });

  it('a status goes by the ordinary move, and a ticket that already has everything is not written at all', async () => {
    await boot([belt('b1', 0, 0), gantry('g', 1, 0, [{ field: 'status', value: 'doing' }, { field: 'priority', value: 'medium' }]), belt('b2', 2, 0)]);
    await engine.transfer('a', { machineId: 'b1' });
    await run(2);
    expect(changes).toEqual([['a', { status: 'doing', fields: {} }]]);  // its priority was medium already
    await engine.giveBack('a');
    infos.set('b', info('b', { status: 'doing' }));
    await engine.transfer('b', { machineId: 'b1' });
    await run(2);
    expect(changes).toHaveLength(1);
    expect(where('b')).toBe('b2:belt');
  });

  it('holds the ticket in the middle of its tile until the write is confirmed', async () => {
    await boot([belt('b1', 0, 0), gantry('g', 1, 0, [inc]), belt('b2', 2, 0)]);
    writes.hold = true;
    await engine.transfer('a', { machineId: 'b1' });
    await run(3);
    expect(where('a')).toBe('g:belt');
    expect(engine.snapshot().tickets.find((t) => t.ticketId === 'a')!.p).toBe(0.5);
    expect(changes).toEqual([]);                                        // asked once, not at every tick
    expect(writes.release).toHaveLength(1);
    writes.hold = false; writes.release[0]!();
    await run(1);
    expect(where('a')).toBe('b2:belt');
    expect(info1().tags).toEqual(['passes:1']);                         // read again from what was written
  });

  it('keeps the ticket and tries again when the write fails, without counting twice', async () => {
    await boot([belt('b1', 0, 0), gantry('g', 1, 0, [inc]), belt('b2', 2, 0)]);
    writes.fail = true;
    await engine.transfer('a', { machineId: 'b1' });
    await run(2);
    const t = engine.snapshot().tickets.find((x) => x.ticketId === 'a')!;
    expect(where('a')).toBe('g:belt');
    expect(t.note).toMatch(/could not write/);
    expect(t.info!.tags).toEqual([]);                                   // what the engine knows went back to what it was
    writes.fail = false;
    await run(6);                                                       // it tries again after a moment
    expect(where('a')).toBe('b2:belt');
    expect(changes).toEqual([['a', { fields: { tags: ['passes:1'] } }]]);
    expect(engine.snapshot().tickets.find((x) => x.ticketId === 'a')!.note).toBe('');
  });

  it('does not count a ticket twice when the server restarts while it is under the gantry', async () => {
    const floor = [belt('b1', 0, 0), gantry('g', 1, 0, [inc]), arm('stop', 1, 1, 1, 'tag', ['never'])];
    await boot(floor);
    await engine.transfer('a', { machineId: 'g' });                     // dropped right on it: it counts there too
    await run(1);
    expect(changes).toHaveLength(1);
    await engine.flush();
    await boot(floor);
    await run(2);
    expect(changes).toHaveLength(1);
    expect(where('a')).toBe('g:belt');                                  // the belt leads nowhere: it waits at its end
  });

  it('counts again each time the ticket comes back under it', async () => {
    await boot([gantry('g', 0, 0, [inc]), belt('b2', 1, 0)]);
    for (let i = 0; i < 3; i++) { await engine.move('a', { machineId: 'g' }).catch(() => engine.transfer('a', { machineId: 'g' })); await run(2); }
    expect(info1().tags).toEqual(['passes:3']);
  });

  it('keeps of a gantry the operations that can be applied, on belts only', () => {
    const out = normaliseLayout({ w: 9, h: 9, machines: [
      { ...belt('g', 0, 0), set: [{ field: 'priority', value: 'high' }, { field: 'priority', value: 'enormous' }, { field: 'status', value: 'done' }, { field: 'tag', op: 'inc', value: ' passes ' }, { field: 'tag', op: 'shout', value: 'x' }, { field: 'colour', value: 'red' }] } as unknown as MachineSpec,
      { ...belt('e', 1, 0), set: [] } as MachineSpec, belt('p', 2, 0),
    ] }).machines as (MachineSpec & { set?: SetOp[] })[];
    expect(out[0]!.set).toEqual([{ field: 'priority', value: 'high' }, { field: 'tag', op: 'inc', value: 'passes' }]);
    expect(out[1]!.set).toEqual([]);                                    // a gantry with nothing to do yet is still a gantry
    expect('set' in out[2]!).toBe(false);
  });
});

describe('a toll', () => {
  /* a loop: a belt under the toll, then a zone the ticket is taken out of and put back on the belt by hand; what is rejected goes to another zone */
  const toll = (when: { field: string; op: string; values: string[] }[], set: SetOp[] = [{ field: 'tag', op: 'inc', value: 'passes' }], out = 1): MachineSpec =>
    ({ ...belt('toll', 1, 0), set, toll: { when, out } } as unknown as MachineSpec);
  const floor = (t: MachineSpec) => [belt('b1', 0, 0), t, belt('b2', 2, 0), zone('on', 3, 0), zone('off', 1, 1)];
  const over3 = [{ field: 'tagkey', op: 'gt', values: ['passes', '3'] }];
  const round = async () => { await engine.move('a', { machineId: 'b1' }); await run(3); return where('a'); };

  it('counts, then rejects: with "passes +1" and "passes > 3" a ticket goes round three times and is taken out the fourth', async () => {
    await boot(floor(toll(over3)));
    await engine.transfer('a', { machineId: 'b1' });
    await run(3);
    expect(where('a')).toBe('on:zone');
    expect([await round(), await round()]).toEqual(['on:zone', 'on:zone']);
    expect(await round()).toBe('off:zone');                             // the operations first, then the condition
    expect(engine.snapshot().tickets.find((t) => t.ticketId === 'a')!.info!.tags).toEqual(['passes:4']);
  });

  it('starts again from nothing once a Set gantry has cleared the count', async () => {
    await boot([...floor(toll(over3)), { ...belt('reset', 6, 0), set: [{ field: 'tag', op: 'clear', value: 'passes' }] } as MachineSpec, zone('back', 7, 0)]);
    infos.set('a', info('a', { tags: ['passes:3'] }));
    await engine.transfer('a', { machineId: 'b1' });
    await run(3);
    expect(where('a')).toBe('off:zone');
    await engine.move('a', { machineId: 'reset' }); await run(2);
    expect(where('a')).toBe('back:zone');
    expect(await round()).toBe('on:zone');
  });

  it('rejects on anything an arm can sort on, and when any of its conditions holds', async () => {
    await boot(floor(toll([{ field: 'type', op: 'is_not', values: ['build'] }, { field: 'priority', op: 'is', values: ['urgent'] }], [])));
    infos.set('b', info('b', { type: 'fix' })); infos.set('c', info('c', { priority: 'urgent' }));
    for (const id of ['a', 'b', 'c']) { await engine.transfer(id, { machineId: 'b1' }); await run(3); }
    expect([where('a'), where('b'), where('c')]).toEqual(['on:zone', 'off:zone', 'off:zone']);
  });

  it('carries what it rejects in its own arm, which the page is told about under the belt\'s id', async () => {
    await boot(floor(toll([{ field: 'type', op: 'is', values: ['build'] }], [])), 30, 12, { armSwing: 1, stationRestMs: 0, teleportRestMs: 0 });
    await engine.transfer('a', { machineId: 'toll' });
    await run(0.3);
    expect(where('a')).toBe('toll:arm');
    expect(engine.snapshot().arms.find((x) => x.id === 'toll')).toMatchObject({ state: 'carry', carrying: 'a' });
    /* the belt under it is free meanwhile: the line does not wait for the arm */
    await engine.transfer('b', { machineId: 'b1' });
    await run(1);
    expect(where('a')).toBe('off:zone');
    expect(engine.snapshot().arms.find((x) => x.id === 'toll')!.carrying).not.toBe('a');     // it may already be on the next one
  });

  it('holds the line when there is nowhere to put what it rejects', async () => {
    await boot([belt('b1', 0, 0), toll([{ field: 'type', op: 'is', values: ['build'] }], []), belt('b2', 2, 0), belt('side', 1, 1, 1)]);
    await engine.transfer('a', { machineId: 'side' });                   // the tile it rejects to is taken, and leads nowhere
    await engine.transfer('b', { machineId: 'b1' });
    await run(3);
    expect(where('b')).toBe('toll:belt');
    await engine.giveBack('a');
    await run(2);
    expect(where('b')).toBe('side:belt');
  });

  it('comes back under the toll after a restart, to be rejected again without being counted again', async () => {
    const f = floor(toll(over3));
    await boot(f, 30, 12, { armSwing: 5, stationRestMs: 0, teleportRestMs: 0 });
    infos.set('a', info('a', { tags: ['passes:3'] }));
    await engine.transfer('a', { machineId: 'toll' });
    await run(0.5);
    expect(where('a')).toBe('toll:arm');
    await engine.flush();
    await boot(f);
    expect(where('a')).toBe('toll:belt');
    await run(3);
    expect(where('a')).toBe('off:zone');
    expect(changes).toEqual([['a', { fields: { tags: ['passes:4'] } }]]);
  });

  it('is a gantry whose arm reaches across the belt: a side along it is put right', () => {
    const out = normaliseLayout({ w: 9, h: 9, machines: [
      { ...belt('t', 0, 0, 0), toll: { when: [{ field: 'tagkey', op: 'gt', values: ['passes', '3'] }, { field: 'nope', op: 'is', values: ['x'] }], out: 0 } } as unknown as MachineSpec,
      { ...belt('u', 2, 0, 1), set: [], toll: { when: [], out: 2 } } as unknown as MachineSpec,
    ] }).machines as (MachineSpec & { set?: SetOp[]; toll?: { when: unknown[]; out: number } })[];
    expect(out[0]!.toll).toEqual({ when: [{ field: 'tagkey', op: 'gt', values: ['passes', '3'] }], out: 1 });
    expect(out[0]!.set).toEqual([]);
    expect(out[1]!.toll).toEqual({ when: [], out: 2 });
  });
});

describe('the emergency stop', () => {
  it('stops everything where it is, cuts the runs in progress, and carries on from there when it is lifted', async () => {
    await boot([belt('b1', 0, 0), belt('b2', 1, 0), belt('b3', 2, 0), station('s', 5, 0, { cap: 2 }), arm('out', 8, 1, 0), zone('z', 9, 0)]);
    await engine.transfer('a', { machineId: 's' });
    await run(0.2);
    expect(where('a')).toBe('s:running');
    pending[0]!.started('exec-1');
    await engine.transfer('b', { machineId: 'b1' });
    await run(0.2);
    const before = engine.snapshot().tickets.find((t) => t.ticketId === 'b')!.p;

    await engine.setHalted(true);
    expect(engine.halted).toBe(true);
    expect(cancelled).toEqual(['exec-1']);                              // the run is cut at once
    expect(where('a')).toBe('s:wait');                                  // and its ticket is back in line, in its place
    expect([...store.runs.values()].find((r) => r.ticketId === 'a')).toMatchObject({ status: 'interrupted', error: 'Cut by the emergency stop' });
    await run(3);
    expect(where('b')).toBe('b1:belt');                                 // nothing moved
    expect(engine.snapshot().tickets.find((t) => t.ticketId === 'b')!.p).toBe(before);
    expect(pending).toHaveLength(1);                                    // nothing started
    expect(store.floor!.settings.halted).toBe(true);                    // and it is written down: a restart of the server keeps it

    /* what the run that was cut returns afterwards is ignored */
    pending[0]!.resolve({ status: 'completed', outcome: 'ok', executionId: 'exec-1', error: null });
    await settle();
    expect(where('a')).toBe('s:wait');

    /* people can still act while it is on */
    await engine.transfer('c', { machineId: 'z' });
    expect(where('c')).toBe('z:zone');

    await engine.setHalted(false);
    expect(store.floor!.settings.halted).toBeUndefined();
    await run(0.2);
    expect(where('a')).toBe('s:running');                               // the run starts over
    expect(pending).toHaveLength(2);
    await run(3);
    expect(where('b')).not.toBe('b1:belt');                             // and the belts run again
  });

  it('is still on after the server restarts', async () => {
    await boot([belt('b1', 0, 0), belt('b2', 1, 0)]);
    await engine.transfer('a', { machineId: 'b1' });
    await engine.setHalted(true);
    await boot([belt('b1', 0, 0), belt('b2', 1, 0)]);
    expect(engine.halted).toBe(true);
    await run(2);
    expect(where('a')).toBe('b1:belt');
  });
});

describe('a decision at a gate', () => {
  it('goes in the thread with its reason', async () => {
    await boot([station('gate', 1, 3, { exec: 'human_gate', name: 'Check spec', outcomes: ['approve', 'reject'] }), arm('ok', 4, 3, 0, 'outcome', ['approve']), zone('next', 5, 3)]);
    await engine.transfer('a', { machineId: 'gate' });
    await engine.resolveGate('a', 'approve', '  keep the mapping editable ');
    await run(3);
    expect(where('a')).toBe('next:zone');
    expect(decisions).toEqual([['a', 'Check spec', 'approve', 'keep the mapping editable']]);
  });
});

describe('layout versions', () => {
  const v1: FactoryLayout = { w: 10, h: 10, machines: [station('s', 1, 1), zone('z', 6, 1)] };

  it('a layout saved before versions existed is version 1', () => {
    expect(versionOf(v1)).toBe(1);
    expect(versionOf({ ...v1, version: 3 })).toBe(3);
    expect(versionOf({ ...v1, version: 0 })).toBe(1);
  });

  it('goes through every step on the way, in order, and stamps the version it reached', () => {
    const steps = {
      2: (l: FactoryLayout) => ({ ...l, machines: l.machines.map((m) => ({ ...m, name: `${m.name}+2` })) }),
      3: (l: FactoryLayout) => ({ ...l, machines: l.machines.map((m) => ({ ...m, name: `${m.name}+3` })) }),
    };
    const { layout, from } = upgradeLayout(v1, steps, 3);
    expect(from).toBe(1);
    expect(layout?.version).toBe(3);
    expect(layout?.machines.map((m) => m.name)).toEqual(['s+2+3', 'z+2+3']);
    expect(upgradeLayout({ ...v1, version: 2 }, steps, 3).layout?.machines[0]?.name).toBe('s+3');
  });

  it('gives up on a layout a step cannot convert, and leaves alone one that is current or newer', () => {
    expect(upgradeLayout(v1, { 2: () => null, 3: (l) => l }, 3).layout).toBeNull();
    const current = { ...v1, version: LAYOUT_VERSION };
    expect(upgradeLayout(current).layout).toBe(current);
    const newer = { ...v1, version: LAYOUT_VERSION + 4 };
    expect(upgradeLayout(newer).layout).toBe(newer);
  });

  it('a floor that cannot be carried over is archived and started over, its tickets back in Inbound', async () => {
    const iso = new Date(clock).toISOString();
    await store.saveFloor({ id: 'default', name: 'Factory', layout: v1, settings: { maxRunsPerHour: 7, maxConcurrentRuns: 2 }, createdAt: iso, updatedAt: iso });
    await store.saveTicket({ ticketId: 'a', floorId: 'default', machineId: 's', createdAt: iso, updatedAt: iso, state: { x: 1, y: 1, phase: 'out', p: 0, fx: 1, fy: 0, outcome: 'ok', released: false, since: iso, runId: null, note: '' } });
    engine = new FactoryEngine({ store, now: () => clock, logger: { warn: () => {}, info: () => {} }, timing: BRISK, loadTicket: async (id) => infos.get(id) ?? null, setStatus: async () => {}, runner: { run: () => new Promise<StationRunResult>(() => {}) } });
    await engine.init();
    const snap = engine.snapshot();
    expect(snap.floor.layout.version).toBe(LAYOUT_VERSION);
    expect(snap.floor.layout.machines.map((m) => m.kind)).toEqual(['zone']);       // an empty floor: only Inbound
    expect(snap.floor.settings.maxRunsPerHour).toBe(7);                             // its settings are kept
    expect(snap.notice).toContain('started over');
    const t = snap.tickets[0]!;
    expect([t.machineId, t.phase, t.outcome]).toEqual([snap.floor.layout.machines[0]!.id, 'zone', '']);
    const archived = [...store.floors.values()].find((f) => f.id !== 'default');
    expect(archived?.id).toMatch(/^default@v1-/);
    expect(archived?.layout.machines).toHaveLength(2);                              // what was built is still there to be read
    engine.ackNotice();
    expect(engine.snapshot().notice).toBeNull();
    /* loaded again, it is current: nothing more is archived */
    const again = new FactoryEngine({ store, now: () => clock, logger: { warn: () => {}, info: () => {} }, timing: BRISK, loadTicket: async (id) => infos.get(id) ?? null, setStatus: async () => {}, runner: { run: () => new Promise<StationRunResult>(() => {}) } });
    await again.init();
    expect(store.floors.size).toBe(2);
    expect(again.snapshot().notice).toBeNull();
  });
});

describe('FactoryEngine saved selections', () => {
  it('keeps the floor groups across a restart, so Shift+digit selections outlive a reload', async () => {
    await boot([belt('b1', 1, 1), belt('b2', 2, 1)]);
    const groups = [{ machine: 'b1' }, { machines: ['b1', 'b2'] }, null, { tickets: ['a', 'b'] }];
    await engine.setSettings({ groups });
    await engine.setSettings({ maxRunsPerHour: 5 });                    // changing a limit must not wipe them
    expect(store.floor!.settings.groups).toEqual([...groups, null, null, null, null, null, null]);

    /* a new engine on the same storage: what a server restart does */
    await boot([belt('b1', 1, 1), belt('b2', 2, 1)]);
    expect(engine.snapshot().floor.settings.groups?.slice(0, 4)).toEqual(groups);
  });

  it('stores only well-formed groups, ten slots, whatever the client sent', async () => {
    await boot([belt('b1', 1, 1)]);
    await engine.setSettings({ groups: [{ machine: '' }, { tickets: [] }, { machines: ['b1', 3] }, 'junk', { ticket: 't1' }, ...Array(12).fill({ machine: 'b1' })] as never });
    const saved = store.floor!.settings.groups!;
    expect(saved).toHaveLength(10);
    expect(saved.slice(0, 5)).toEqual([null, null, null, null, { ticket: 't1' }]);
  });
});
