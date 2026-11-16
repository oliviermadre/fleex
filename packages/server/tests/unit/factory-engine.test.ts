/**
 * The Factory engine, on an in-memory store and a fake station runner: belts,
 * arms and their filters, stations and their outcomes, gates, zones, the exit,
 * the safety limits and what survives a restart.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FactoryEngine, FactoryError, normaliseLayout } from '../../src/factory/engine.js';
import type { FactoryStorePort } from '../../src/factory/factory-store.port.js';
import type { StationRunResult } from '../../src/factory/station-runner.js';
import type { ArmCondition, FactoryFloorRow, FactoryLayout, FactoryRunRow, FactoryTicketInfo, FactoryTicketRow, MachineSpec, StationSpec } from '../../src/factory/types.js';

class MemoryStore implements FactoryStorePort {
  floor: FactoryFloorRow | null = null;
  tickets = new Map<string, FactoryTicketRow>();
  runs = new Map<string, FactoryRunRow>();
  async getFloor() { return this.floor; }
  async saveFloor(f: FactoryFloorRow) { this.floor = structuredClone(f); }
  async listTickets() { return [...this.tickets.values()].map((t) => structuredClone(t)); }
  async saveTicket(t: FactoryTicketRow) { this.tickets.set(t.ticketId, structuredClone(t)); }
  async removeTicket(id: string) { this.tickets.delete(id); }
  async listManagedTicketIds() { return [...this.tickets.keys()]; }
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
let pending: { station: string; ticketId: string; resolve: (r: StationRunResult) => void }[];
let clock: number;
let engine: FactoryEngine;

const info = (id: string, over: Partial<FactoryTicketInfo> = {}): FactoryTicketInfo => ({ id, displayId: 1, title: id, type: 'build', priority: 'medium', status: 'todo', tags: [], boardId: 'b1', complexity: null, favorite: false, ...over });
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
/** Advance the floor by `seconds`, in small ticks, letting async work land in between. */
const run = async (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { clock += 100; engine.tick(0.1); await settle(); } };
const where = (ticketId: string) => { const t = engine.snapshot().tickets.find((x) => x.ticketId === ticketId); return t ? `${t.machineId ?? 'floor'}:${t.phase}` : 'gone'; };

/** The floor's own paces (a slow arm, a rest in each station) are asked for by the tests that are about them; the others run brisk. */
const BRISK = { armSwing: 0.45, stationRestMs: 0 };
async function boot(machines: MachineSpec[], w = 30, h = 12, timing: { armSwing?: number; stationRestMs?: number } | 'real' = BRISK): Promise<void> {
  const layout: FactoryLayout = { w, h, machines };
  engine = new FactoryEngine({
    store, now: () => clock, logger: { warn: () => {}, info: () => {} }, timing: timing === 'real' ? undefined : timing,
    loadTicket: async (id) => infos.get(id) ?? null,
    setStatus: async (id, status) => { statuses.push([id, status]); },
    runner: { run: (s, ticketId) => new Promise<StationRunResult>((resolve) => { pending.push({ station: s.id, ticketId, resolve }); }) },
  });
  await engine.init();
  await engine.setLayout(layout);
}

beforeEach(() => {
  store = new MemoryStore(); infos = new Map(); statuses = []; pending = []; clock = Date.parse('2026-11-15T10:00:00.000Z');
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
});

describe('normaliseLayout', () => {
  it('refuses overlaps and duplicate ids, and records how far the floor extends', () => {
    expect(() => normaliseLayout({ w: 10, h: 10, machines: [belt('a', 1, 1), belt('b', 1, 1)] })).toThrow(/overlap/);
    expect(normaliseLayout({ w: 0, h: 0, machines: [station('s', -8, 8), belt('a', 30, 2)] })).toMatchObject({ w: 39, h: 9 });
    expect(() => normaliseLayout({ w: 10, h: 10, machines: [belt('a', 1, 1), belt('a', 2, 1)] })).toThrow(/unique id/);
  });

  it('gives each kind its footprint and a station at least one outcome', () => {
    const out = normaliseLayout({ w: 20, h: 20, machines: [{ ...station('s', 1, 1), w: 9, h: 9, outcomes: [] } as MachineSpec, { ...station('n', 6, 1, { exec: 'native' }), w: 9 } as MachineSpec] });
    expect(out.machines.map((m) => [m.w, m.h])).toEqual([[3, 3], [2, 2]]);
    expect((out.machines[0] as StationSpec).outcomes).toEqual(['ok']);
  });
});
