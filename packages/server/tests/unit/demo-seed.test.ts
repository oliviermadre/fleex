import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  SeedDemoUseCase,
  resolveDemoDate,
  DemoNotEmptyError,
  DemoSeedError,
  type DemoSeed,
} from '../../src/application/demo/seed-demo.js';
import { demoRoutes, isDemoMode } from '../../src/infrastructure/http/demo.routes.js';

/** In-memory stand-ins for exactly the store methods the seed uses. */
function memoryStores() {
  const db = {
    boards: [] as any[], tickets: [] as any[], activities: [] as any[], groups: [] as any[],
    groupBoards: [] as Array<[string, string]>, memberships: [] as Array<[string, string]>,
    comments: [] as any[], deliverables: [] as any[], annotations: [] as any[], runs: [] as any[],
    steps: [] as any[], personas: [{ name: 'builder' }] as any[],
  };
  const stores = {
    ticketStore: {
      getAllBoards: async () => db.boards,
      getAllTickets: async () => db.tickets,
      saveBoard: async (b: any) => { db.boards.push(b); },
      createTicket: async (t: any) => { t.displayId = db.tickets.length + 1; db.tickets.push(t); },
      saveActivity: async (a: any) => { db.activities.push(a); },
    },
    ticketGroupStore: {
      saveTicketGroup: async (g: any) => { db.groups.push(g); },
      addBoardToGroup: async (g: string, b: string) => { db.groupBoards.push([g, b]); },
      addMembership: async (t: string, g: string) => { db.memberships.push([t, g]); },
    },
    commentStore: { save: async (c: any) => { db.comments.push(c); } },
    deliverableStore: { save: async (d: any) => { db.deliverables.push(d); } },
    annotationStore: { save: async (a: any) => { db.annotations.push(a); } },
    workflowRunStore: { save: async (r: any) => { db.runs.push(r); } },
    stepRunStore: { save: async (s: any) => { db.steps.push(s); } },
    personaStore: { getAll: async () => db.personas, save: async (p: any) => { db.personas.push(p); } },
  };
  return { db, stores: stores as any };
}

const NOW = new Date('2026-10-24T10:00:00.000Z');
const HOUR = 3600e3;

const seed: DemoSeed = {
  personas: [{ name: 'builder' }, { name: 'herald', displayName: 'Herald', emoji: '📣' }],
  boards: [{ key: 'nova', name: 'Atelier Nova', emoji: '🎨' }],
  epics: [{ key: 'pay', name: 'Paiements', boards: ['nova'] }],
  tickets: [
    {
      key: 'nova-12', board: 'nova', title: 'Paiement en 3 fois', status: 'doing', priority: 'high',
      epic: 'pay', persona: 'builder', createdAt: '-3d',
      comments: [{ persona: 'builder', at: '-2h', body: 'PR ouverte' }, { author: 'nas', at: '-90m', body: 'top' }],
      deliverables: [{ title: 'PRD', type: 'prd', persona: 'catalyst', at: '-1d', content: '# PRD' }],
      annotations: [{ at: '-1h', title: 'Plafond Alma 3 000 €', tone: 'warning' }],
      workflowRun: { steps: [{ name: 'Spec', persona: 'catalyst', at: '-1d' }, { name: 'Check', gate: true, at: '-20h' }, { name: 'Build', persona: 'builder', at: '-4h' }] },
    },
    { key: 'nova-13', board: 'nova', title: 'Export iCal', createdAt: '-5d' },
  ],
};

describe('resolveDemoDate', () => {
  it('reads relative offsets so "il y a 2 h" stays true on the day of the screenshot', () => {
    expect(resolveDemoDate('-2h', NOW).getTime()).toBe(NOW.getTime() - 2 * HOUR);
    expect(resolveDemoDate('-30m', NOW).getTime()).toBe(NOW.getTime() - 30 * 60e3);
    expect(resolveDemoDate('-3d', NOW).getTime()).toBe(NOW.getTime() - 72 * HOUR);
    expect(resolveDemoDate('-1w', NOW).getTime()).toBe(NOW.getTime() - 168 * HOUR);
    expect(resolveDemoDate('2026-10-01T00:00:00Z', NOW).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rejects a typo instead of silently dating it "now"', () => {
    expect(() => resolveDemoDate('2h', NOW)).toThrow(DemoSeedError);
    expect(() => resolveDemoDate('-2 days', NOW)).toThrow(/invalid date/);
  });
});

describe('SeedDemoUseCase', () => {
  it('writes the whole backlog with backdated timestamps and returns keys → ids', async () => {
    const { db, stores } = memoryStores();
    const res = await new SeedDemoUseCase(stores).execute(seed, NOW);

    expect(res).toMatchObject({ boards: 1, epics: 1, tickets: 2, comments: 2, deliverables: 1, annotations: 1, workflowRuns: 1, personas: 1 });
    expect(res.ticketsByKey['nova-12']).toEqual({ id: db.tickets[0].id, displayId: 1 });

    const t = db.tickets[0];
    expect(t.createdAt.getTime()).toBe(NOW.getTime() - 72 * HOUR);
    expect(t.assignee).toBe('builder');
    expect(t.firstDoingAt).not.toBeNull();
    // The timeline draws status zones from activities: created + the move to its status.
    const acts = db.activities.filter((a: any) => a.ticketId === t.id);
    expect(acts.map((a: any) => a.action)).toEqual(['created', 'moved']);
    expect(acts[1].changes.status).toEqual({ from: 'backlog', to: 'doing' });

    expect(db.comments[0]).toMatchObject({ authorType: 'agent', authorName: 'builder' });
    expect(db.comments[1]).toMatchObject({ authorType: 'user', authorName: 'nas' });
    expect(db.comments[0].createdAt.getTime()).toBe(NOW.getTime() - 2 * HOUR);
    expect(db.memberships).toEqual([[t.id, db.groups[0].id]]);
    expect(db.groupBoards).toEqual([[db.groups[0].id, db.boards[0].id]]);
    // Only the missing persona is created; the installed one is reused.
    expect(db.personas.map((p: any) => p.name)).toEqual(['builder', 'herald']);
  });

  it('seeds a finished run: one completed step per seed step, the gate approved', async () => {
    const { db, stores } = memoryStores();
    await new SeedDemoUseCase(stores).execute(seed, NOW);
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0]).toMatchObject({ status: 'completed', ticketId: db.tickets[0].id });
    expect(db.steps.map((s: any) => s.status)).toEqual(['completed', 'completed', 'completed']);
    expect(db.steps[1].output).toMatchObject({ outcome: 'approve' });
    expect(db.runs[0].templateSnapshot.steps[1].executorType).toBe('human_gate');
  });

  it('refuses to seed an instance that already has data (reset recreates the DB)', async () => {
    const { db, stores } = memoryStores();
    db.boards.push({ id: 'x' });
    await expect(new SeedDemoUseCase(stores).execute(seed, NOW)).rejects.toBeInstanceOf(DemoNotEmptyError);
  });

  it('reports every seed error at once and writes nothing', async () => {
    const { db, stores } = memoryStores();
    const bad: DemoSeed = {
      boards: [{ key: 'nova', name: 'Nova' }],
      tickets: [
        { key: 'a', board: 'nope', title: 'A' },
        { key: 'b', board: 'nova', title: 'B', comments: [{ at: '2h', body: 'x' }] },
      ],
    };
    const err = await new SeedDemoUseCase(stores).execute(bad, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(DemoSeedError);
    expect(err.message).toMatch(/ticket a: unknown board "nope"/);
    expect(err.message).toMatch(/ticket b comment: invalid date "2h"/);
    expect(db.boards).toHaveLength(0);
  });
});

describe('demo routes', () => {
  it('exist only in demo mode', () => {
    expect(isDemoMode({ FLEEX_DEMO_MODE: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDemoMode({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isDemoMode({ FLEEX_DEMO_MODE: 'true' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('POST /api/demo/seed: 200 then 409 on a second call, 400 on a bad seed', async () => {
    const { stores } = memoryStores();
    const app = Fastify();
    await app.register(demoRoutes(stores));
    const ok = await app.inject({ method: 'POST', url: '/api/demo/seed', payload: { seed, now: NOW.toISOString() } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tickets).toBe(2);
    const again = await app.inject({ method: 'POST', url: '/api/demo/seed', payload: { seed } });
    expect(again.statusCode).toBe(409);

    const { stores: fresh } = memoryStores();
    const app2 = Fastify();
    await app2.register(demoRoutes(fresh));
    const bad = await app2.inject({ method: 'POST', url: '/api/demo/seed', payload: { seed: { tickets: [{ key: 'x', board: 'none', title: 'x' }] } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/unknown board/);
  });
});
