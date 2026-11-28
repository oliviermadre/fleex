/**
 * The floor for whoever operates it without the page (the CLI, the MCP, another program): what `operate.ts` reads
 * out of a snapshot, the edits of one machine at a time, and the routes that serve both, over the real module on an
 * in-memory store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { EventBus } from '../../src/application/event-bus.js';
import { FactoryModule, createFactoryModule } from '../../src/factory/factory.module.js';
import { factoryRoutes } from '../../src/factory/factory.routes.js';
import { registerErrorHandler } from '../../src/infrastructure/http/error-handler.js';
import type { FactoryStorePort } from '../../src/factory/factory-store.port.js';
import type { FactoryFloorRow, FactoryItemRow, FactoryLayout, FactoryTicketRow, MachineSpec } from '../../src/factory/types.js';
import type { FloorMachine, FloorOverview, FloorToken, Need } from '../../src/factory/operate.js';
import { withMachinePatched, withMachines, withoutMachine } from '../../src/factory/operate.js';

function memoryStore(): FactoryStorePort {
  const floors = new Map<string, FactoryFloorRow>(), tickets = new Map<string, FactoryTicketRow>(), items = new Map<string, FactoryItemRow>();
  return {
    getFloor: async (id) => floors.get(id) ?? null,
    saveFloor: async (f) => { floors.set(f.id, structuredClone(f)); },
    listTickets: async () => [...tickets.values()],
    saveTicket: async (t) => { tickets.set(t.ticketId, structuredClone(t)); },
    removeTicket: async (id) => { tickets.delete(id); },
    listManagedTicketIds: async () => [...tickets.keys()],
    listItems: async () => [...items.values()].filter((i) => !i.archivedAt),
    getItem: async (id: string) => items.get(id) ?? null,
    getItemByKey: async () => null,
    saveItem: async (i: FactoryItemRow) => { items.set(i.id, structuredClone(i)); },
    countDropped: async () => ({}), listIntakePulls: async () => [], listExitItems: async () => [], listArchivedItems: async () => [...items.values()].filter((i) => i.archivedAt),
    saveItemBody: async () => {}, getItemBody: async () => null, saveIntakePull: async () => {}, saveItemRun: async () => {}, listItemRuns: async () => [],
    listRecentItemRuns: async () => [], listItemRunsSince: async () => [],
    saveRun: async () => {},
    listRunsByTicket: async () => [], listRecentRuns: async () => [], listRunsSince: async () => [], countRunsSince: async () => 0,
    interruptRunningRuns: async () => [],
  } as unknown as FactoryStorePort;
}

const zone = (id: string, x: number, y: number, over: Record<string, unknown> = {}): MachineSpec => ({ id, kind: 'zone', x, y, w: 2, h: 2, name: id, release: 'manual', ...over } as MachineSpec);
const gate = (id: string, x: number, y: number): MachineSpec => ({ id, kind: 'station', exec: 'human_gate', x, y, w: 5, h: 5, name: id, outcomes: ['approved', 'rejected'], cap: 4 });
const agent = (id: string, x: number, y: number, ref?: string): MachineSpec => ({ id, kind: 'station', exec: 'agent', x, y, w: 5, h: 5, name: id, outcomes: ['ok'], cap: 2, ...(ref ? { ref } : {}) });

let enabled: boolean;
let factory: FactoryModule;
let app: FastifyInstance;

const TICKETS: Record<string, number> = { a: 1, b: 2, c: 3 };
const get = async <T>(url: string): Promise<T> => (await app.inject({ method: 'GET', url })).json() as T;
const send = (method: 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeEach(async () => {
  enabled = true;
  factory = createFactoryModule({
    store: memoryStore(), eventBus: new EventBus(),
    config: { get: () => ({ factoryEnabled: enabled, humanDisplayName: 'Ada' }) } as never,
    ticketStore: { getTicketById: async (id: string) => (TICKETS[id] ? { toDTO: () => ({ id, displayId: TICKETS[id], title: `Ticket ${id}`, status: 'todo', type: 'fix', priority: 'high', tags: ['x'], boardId: 'b1', archivedAt: null }) } : null) } as never,
    skillStore: {} as never, personaStore: {} as never, agentEventStore: {} as never, executeAgent: {} as never, runPanel: {} as never,
    applyTicketMutation: { execute: async () => {} } as never, submitDeliverable: {} as never,
    postComment: { execute: async () => ({ comment: { id: 'c1' } }) } as never,
    logger: { warn: () => {}, info: () => {} },
  })!;
  await factory.ensureReady();
  await factory.engine.setLayout({ w: 0, h: 0, machines: [zone('Inbound', 0, 0, { inbound: true }), zone('Doing', 0, 4, { needsYou: true }), gate('Review', 10, 0), agent('Builder', 20, 0, 'builder'), agent('Unset', 30, 0), { id: 'x1', kind: 'exit', x: 40, y: 0, w: 2, h: 2, name: 'Shipped' }] });
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(factoryRoutes(factory));
});

afterEach(async () => { await app.close(); });

describe('reading the floor in words', () => {
  it('tells where a ticket stands, what it waits for and what can be done with it', async () => {
    await factory.engine.transfer('a');
    const inbound = await get<FloorToken>('/api/factory/tickets/a');
    expect(inbound).toMatchObject({ id: 'a', kind: 'ticket', displayId: 1, title: 'Ticket a', where: 'Inbound', phase: 'zone', state: 'Kept there', need: null, type: 'fix', priority: 'high', status: 'todo' });
    expect(inbound.actions).toEqual(['release', 'move', 'take-back']);

    await factory.engine.move('a', { machineId: 'Review' });
    factory.engine.tick(0.25);
    const atGate = await get<FloorToken>('/api/factory/tickets/a');
    expect(atGate).toMatchObject({ where: 'Review', phase: 'review', state: 'Waiting for a decision', need: 'decision', outcomes: ['approved', 'rejected'] });
    expect(atGate.actions).toContain('decide');
  });

  it('lists what waits for someone, the longest wait first, and nothing that waits for nobody', async () => {
    await factory.engine.transfer('a');
    await factory.engine.transfer('b', { machineId: 'Doing' });
    await factory.engine.transfer('c', { x: 60, y: 60 });
    const needs = await get<Need[]>('/api/factory/needs');
    expect(needs.map((n) => [n.token.id, n.kind, n.label]).sort()).toEqual([['b', 'zone', 'waiting for you'], ['c', 'floor', 'on the floor']]);
    expect(needs.every((n) => n.waitMs >= 0)).toBe(true);
    expect((await get<FloorToken[]>('/api/factory/tickets')).map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
    expect((await get<FloorToken[]>('/api/factory/tickets?machineId=Doing')).map((t) => t.id)).toEqual(['b']);
  });

  it('answers 404 for a ticket that is not on the floor, and for a machine that is not built', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/factory/tickets/a' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/factory/machines/nope' })).statusCode).toBe(404);
  });

  it('gives the floor at a glance: counts, limits, what waits, and the stations that start nothing', async () => {
    await factory.engine.transfer('a', { x: 60, y: 60 });
    await factory.engine.setPower('Builder', false);
    const o = await get<FloorOverview>('/api/factory/overview');
    expect(o).toMatchObject({ halted: false, tickets: 1, items: 0, needs: 1, needsByKind: { floor: 1 }, limits: { maxRunsPerHour: 20, maxConcurrentRuns: 3 }, machines: { zone: 2, station: 3, exit: 1 } });
    expect(o.idleStations).toEqual([{ id: 'Builder', name: 'Builder', why: 'switched off' }, { id: 'Unset', name: 'Unset', why: 'not set up (no persona)' }]);
    await send('POST', '/api/factory/halt', { on: true });
    expect((await get<FloorOverview>('/api/factory/overview')).halted).toBe(true);
  });

  it('lists machines without their settings, and gives one with its spec and what stands on it', async () => {
    await factory.engine.transfer('a', { machineId: 'Review' });
    const list = await get<FloorMachine[]>('/api/factory/machines');
    expect(list.map((m) => m.name)).toEqual(['Inbound', 'Doing', 'Review', 'Builder', 'Unset', 'Shipped']);
    expect(list.find((m) => m.id === 'Review')).toMatchObject({ kind: 'station', exec: 'human_gate', holds: 1, off: false, gap: null });
    expect(list.find((m) => m.id === 'Unset')).toMatchObject({ gap: 'no persona' });
    expect(list[0]).not.toHaveProperty('spec');
    expect((await get<FloorMachine[]>('/api/factory/machines?kind=exit')).map((m) => m.id)).toEqual(['x1']);
    const one = await get<FloorMachine & { spec: MachineSpec; tokens: FloorToken[] }>('/api/factory/machines/Review');
    expect(one.spec).toMatchObject({ id: 'Review', outcomes: ['approved', 'rejected'] });
    expect(one.tokens.map((t) => t.id)).toEqual(['a']);
  });

  it('answers 403 on every reading while the Factory is off', async () => {
    enabled = false;
    for (const url of ['/api/factory/overview', '/api/factory/needs', '/api/factory/tickets', '/api/factory/machines', '/api/factory/layout']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(403);
    }
  });
});

describe('one machine at a time', () => {
  it('adds a machine, giving it an id, and a line of belts in one request', async () => {
    const one = await send('POST', '/api/factory/machines', { kind: 'zone', x: 50, y: 50, name: 'Queue' });
    expect(one.statusCode).toBe(200);
    const [added] = (one.json() as { machines: (FloorMachine & { spec: MachineSpec })[] }).machines;
    expect(added).toMatchObject({ kind: 'zone', name: 'Queue', x: 50, y: 50 });
    expect(added!.id).toMatch(/^[0-9a-f-]{36}$/);
    const line = await send('POST', '/api/factory/machines', { machines: [0, 1, 2].map((i) => ({ kind: 'belt', x: 60 + i, y: 50, dir: 0 })) });
    expect((line.json() as { machines: FloorMachine[] }).machines.map((m) => [m.x, m.dir])).toEqual([[60, 'east'], [61, 'east'], [62, 'east']]);
    expect((await get<{ layout: FactoryLayout }>('/api/factory/layout')).layout.machines).toHaveLength(10);
  });

  it('refuses what cannot be built, with the reason, and leaves the floor as it was', async () => {
    const overlap = await send('POST', '/api/factory/machines', { kind: 'belt', x: 0, y: 0, dir: 0 });
    expect(overlap.statusCode).toBe(400);
    expect(overlap.json()).toMatchObject({ error: 'FACTORY_REFUSED', message: 'two machines overlap at 0,0' });
    expect((await send('POST', '/api/factory/machines', { x: 1, y: 1 })).json()).toMatchObject({ message: expect.stringContaining('needs a kind') });
    expect((await send('POST', '/api/factory/machines', { kind: 'belt' })).json()).toMatchObject({ message: expect.stringContaining('needs a position') });
    expect((await get<FloorMachine[]>('/api/factory/machines'))).toHaveLength(6);
  });

  it('changes only what the patch names, takes a setting off with null, and keeps what stands on the machine', async () => {
    await factory.engine.transfer('a', { machineId: 'Builder' });
    const res = await send('PATCH', '/api/factory/machines/Builder', { prompt: 'Build it', cap: 3, ref: null });
    expect(res.statusCode).toBe(200);
    const after = res.json() as FloorMachine & { spec: Record<string, unknown>; tokens: FloorToken[] };
    expect(after.spec).toMatchObject({ prompt: 'Build it', cap: 3, name: 'Builder', outcomes: ['ok'] });
    expect(after.spec).not.toHaveProperty('ref');
    expect(after.gap).toBe('no persona');
    expect(after.tokens.map((t) => t.id)).toEqual(['a']);
  });

  it('never lets a machine become another one', async () => {
    expect((await send('PATCH', '/api/factory/machines/Builder', { kind: 'zone' })).json()).toMatchObject({ message: expect.stringContaining('stays a station') });
    expect((await send('PATCH', '/api/factory/machines/Builder', { id: 'other' })).statusCode).toBe(400);
    expect((await send('PATCH', '/api/factory/machines/nope', { name: 'x' })).json()).toMatchObject({ message: 'Unknown machine' });
  });

  it('removes a machine and leaves what stood on it on the floor', async () => {
    await factory.engine.transfer('a', { machineId: 'Doing' });
    expect((await send('DELETE', '/api/factory/machines/Doing')).json()).toEqual({ removed: 'Doing' });
    expect(await get<FloorToken>('/api/factory/tickets/a')).toMatchObject({ machineId: null, where: 'Floor', phase: 'loose', need: 'floor' });
    expect((await send('DELETE', '/api/factory/machines/Doing')).statusCode).toBe(400);
  });

  it('does not touch the layout it was given', () => {
    const layout: FactoryLayout = { w: 0, h: 0, machines: [zone('z', 0, 0)] };
    const frozen = JSON.stringify(layout);
    withMachines(layout, { kind: 'belt', x: 9, y: 9, dir: 1 });
    withMachinePatched(layout, 'z', { name: 'Other' });
    withoutMachine(layout, 'z');
    expect(JSON.stringify(layout)).toBe(frozen);
    expect(() => withMachines(layout, { id: 'z', kind: 'belt', x: 9, y: 9 })).toThrow('already on the floor');
  });
});

describe('operating a ticket through the routes a command calls', () => {
  it('hands a ticket over, decides at a gate with a reason, and sees it leave by that outcome', async () => {
    expect((await send('POST', '/api/factory/tickets/a/transfer', { machineId: 'Review' })).statusCode).toBe(200);
    factory.engine.tick(0.25);
    expect((await send('POST', '/api/factory/tickets/a/resolve', { outcome: 'nope' })).json()).toMatchObject({ error: 'FACTORY_REFUSED', message: '"nope" is not an outcome of Review' });
    expect((await send('POST', '/api/factory/tickets/a/resolve', { outcome: 'approved', reason: 'fine' })).statusCode).toBe(200);
    expect(await get<FloorToken>('/api/factory/tickets/a')).toMatchObject({ phase: 'out', outcome: 'approved', state: 'Done as approved, waiting to be taken', need: null });
    expect((await send('DELETE', '/api/factory/tickets/a')).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/factory/tickets/a' })).statusCode).toBe(404);
  });
});
