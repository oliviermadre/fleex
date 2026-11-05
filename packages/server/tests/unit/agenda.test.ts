import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { WorkflowTemplateSnapshot, AgendaResponse } from '@fleex/shared';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { DomainEventLogEntity } from '../../src/domain/entities/domain-event-log.entity.js';
import { runTimesBetween } from '../../src/domain/services/routine-schedule.js';
import { buildAgenda, waitSegments, UPCOMING_CAP, GetAgendaUseCase } from '../../src/application/use-cases/get-agenda.js';
import type { CalendarEvent } from '@fleex/shared';
import { TicketGroupEntity } from '../../src/domain/entities/ticket-group.entity.js';
import { missedSlotKey } from '../../src/application/services/missed-slots.js';
import { agendaRoutes, parseAgendaPrefs } from '../../src/infrastructure/http/agenda.routes.js';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';

const D = (s: string) => new Date(s);
// Thu 5 Nov 2026 11:30 Paris = 10:30Z; window = the week Mon 2 → Mon 9 (Paris midnight).
const W = { from: D('2026-11-01T23:00:00Z'), to: D('2026-11-08T23:00:00Z'), now: D('2026-11-05T10:30:00Z') };

function ticket(over: { id: string; title?: string; status?: 'done' | 'doing' | 'todo'; createdAt?: string; statusChangedAt?: string; dueDate?: string; links?: TicketEntity['links'] }) {
  const t = TicketEntity.create({
    id: over.id, boardId: 'b1', displayId: Number(over.id.replace(/\D/g, '')) || 1, title: over.title ?? `T ${over.id}`,
    status: over.status ?? 'todo', links: over.links, dueDate: over.dueDate ? D(over.dueDate) : null,
  });
  (t as unknown as { createdAt: Date }).createdAt = D(over.createdAt ?? '2026-10-01T10:00:00Z');
  t.statusChangedAt = D(over.statusChangedAt ?? '2026-10-01T10:00:00Z');
  return t;
}

function routine(id: string, trigger: RoutineEntity['trigger'], enabled = true) {
  return RoutineEntity.create({ id, name: `R ${id}`, target: { kind: 'workflow', ref: 'wf' } as RoutineEntity['target'], trigger, enabled });
}

const SNAP: WorkflowTemplateSnapshot = {
  name: 'Spec Dev PR (HITL)', emoji: '🧪', entryStepId: 'spec',
  steps: [
    { id: 'spec', name: 'Spec', executorType: 'agent' },
    { id: 'gate', name: 'Check Spec', executorType: 'human_gate' },
    { id: 'build', name: 'Build', executorType: 'agent' },
  ] as WorkflowTemplateSnapshot['steps'],
  edges: [],
};

function run(over: { id: string; ticketId?: string; routineId?: string; status?: WorkflowRunEntity['status']; start: string; end?: string | null; currentStepId?: string; triggeredFrom?: string }) {
  return new WorkflowRunEntity(
    over.id, over.ticketId ?? null, 'tpl', SNAP, over.status ?? 'completed', over.currentStepId ?? null, 'user',
    over.triggeredFrom ?? 'cron', D(over.start), over.end ? D(over.end) : null, D(over.start), D(over.start), over.routineId ?? null,
  );
}

let seq = 0;
function ev(eventType: string, at: string, payload: Record<string, unknown> = {}) {
  return DomainEventLogEntity.create({ id: `e${++seq}`, eventType, payload: { type: eventType, ...payload }, instanceId: 'i', occurredAt: D(at) });
}

const build = (src: Partial<Parameters<typeof buildAgenda>[0]>) =>
  buildAgenda({ tickets: [], routines: [], runs: [], events: [], ...src }, W);
const ofType = (r: AgendaResponse, type: string) => r.items.filter((i) => i.type === type);

describe('runTimesBetween', () => {
  const daily9 = { kind: 'cron' as const, cron: '0 9 * * 1-5', timezone: 'Europe/Paris' };

  it('lists every weekday 09:00 Paris of the week, and nothing on the weekend', () => {
    const { times, truncated } = runTimesBetween(daily9, W.from, W.to, 100);
    expect(truncated).toBe(false);
    expect(times.map((t) => t.toISOString())).toEqual([
      '2026-11-02T08:00:00.000Z', '2026-11-03T08:00:00.000Z', '2026-11-04T08:00:00.000Z',
      '2026-11-05T08:00:00.000Z', '2026-11-06T08:00:00.000Z',
    ]);
  });

  it('keeps 09:00 local across the October DST change (07:00Z before, 08:00Z after)', () => {
    // Week of the change: Sun 25 Oct 2026 03:00 → 02:00. 09:00 Paris is 07:00Z before, 08:00Z after.
    const { times } = runTimesBetween(daily9, D('2026-10-22T00:00:00Z'), D('2026-10-28T00:00:00Z'), 100);
    expect(times.map((t) => t.toISOString())).toEqual([
      '2026-10-22T07:00:00.000Z', '2026-10-23T07:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-10-27T08:00:00.000Z',
    ]);
  });

  it('includes a slot exactly at `from` and excludes one exactly at `to`', () => {
    const hourly = { kind: 'cron' as const, cron: '0 * * * *', timezone: 'UTC' };
    const { times } = runTimesBetween(hourly, D('2026-11-05T10:00:00Z'), D('2026-11-05T12:00:00Z'), 10);
    expect(times.map((t) => t.toISOString())).toEqual(['2026-11-05T10:00:00.000Z', '2026-11-05T11:00:00.000Z']);
  });

  it('caps a high-frequency routine and says so, instead of returning thousands of slots', () => {
    const every5 = { kind: 'cron' as const, cron: '*/5 * * * *', timezone: 'UTC' };
    const { times, truncated } = runTimesBetween(every5, W.from, W.to, 500);
    expect(times).toHaveLength(500);
    expect(truncated).toBe(true);
  });

  it('gives a once routine one slot only inside the window, and manual none', () => {
    expect(runTimesBetween({ kind: 'once', runAt: '2026-11-06T07:00:00Z', timezone: 'UTC' }, W.from, W.to, 10).times).toHaveLength(1);
    expect(runTimesBetween({ kind: 'once', runAt: '2026-12-06T07:00:00Z', timezone: 'UTC' }, W.from, W.to, 10).times).toHaveLength(0);
    expect(runTimesBetween({ kind: 'manual' }, W.from, W.to, 10).times).toHaveLength(0);
  });
});

describe('buildAgenda — tickets', () => {
  it('shows a ticket created in the window, not one created before it', () => {
    const r = build({ tickets: [ticket({ id: 't1', createdAt: '2026-11-03T09:00:00Z' }), ticket({ id: 't2', createdAt: '2026-10-20T09:00:00Z' })] });
    expect(ofType(r, 'ticket.created').map((i) => i.ticket?.id)).toEqual(['t1']);
  });

  it('dates "done" with the ticket.moved event, and falls back to statusChangedAt when no event was emitted', () => {
    // 40 of 48 real "done" tickets had no ticket.moved event — they must still show up.
    const withEvent = ticket({ id: 't1', status: 'done', statusChangedAt: '2026-11-04T20:00:00Z' });
    const withoutEvent = ticket({ id: 't2', status: 'done', statusChangedAt: '2026-11-03T18:00:00Z' });
    const notDone = ticket({ id: 't3', status: 'doing', statusChangedAt: '2026-11-03T18:00:00Z' });
    const r = build({
      tickets: [withEvent, withoutEvent, notDone],
      events: [ev('ticket.moved', '2026-11-04T12:00:00Z', { ticketId: 't1', toStatus: 'done' })],
    });
    const done = ofType(r, 'ticket.done');
    expect(done.map((i) => [i.ticket?.id, i.start])).toEqual([
      ['t2', '2026-11-03T18:00:00.000Z'],
      ['t1', '2026-11-04T12:00:00.000Z'],
    ]);
  });

  it('flags a due date in the past as overdue only while the ticket is not done', () => {
    const r = build({ tickets: [
      ticket({ id: 't1', dueDate: '2026-11-03T00:00:00Z' }),
      ticket({ id: 't2', dueDate: '2026-11-03T00:00:00Z', status: 'done' }),
      ticket({ id: 't3', dueDate: '2026-11-06T00:00:00Z' }),
    ] });
    expect(ofType(r, 'ticket.due').map((i) => [i.ticket?.id, i.start, i.overdue])).toEqual([
      ['t1', '2026-11-03', true], ['t2', '2026-11-03', false], ['t3', '2026-11-06', false],
    ]);
  });
});

describe('buildAgenda — runs', () => {
  it('includes a run that started before the window but is still running, and a run that ended before it is left out', () => {
    // #750 in the real data: started Tuesday, still waiting on Thursday.
    const r = build({
      tickets: [ticket({ id: 't750' })],
      runs: [
        run({ id: 'r1', ticketId: 't750', status: 'needs_review', start: '2026-10-30T14:00:00Z', end: null, currentStepId: 'gate' }),
        run({ id: 'r2', ticketId: 't750', start: '2026-10-20T14:00:00Z', end: '2026-10-21T14:00:00Z' }),
      ],
    });
    const w1 = ofType(r, 'workflow.run');
    expect(w1.map((i) => i.runId)).toEqual(['r1']);
    expect(w1[0]!.title).toBe('T t750');
    expect(w1[0]!.currentStep).toBe('Check Spec');
    expect(w1[0]!.end).toBeNull();
  });

  it('puts a routine run under its routine (R1) and a ticket run under its ticket (W1)', () => {
    const r = build({
      tickets: [ticket({ id: 't1', title: 'vue agenda' })],
      routines: [routine('ro1', { kind: 'manual' })],
      runs: [
        run({ id: 'a', routineId: 'ro1', start: '2026-11-03T08:00:00Z', end: '2026-11-03T08:00:18Z', triggeredFrom: 'manual' }),
        run({ id: 'b', ticketId: 't1', start: '2026-11-03T09:00:00Z', end: '2026-11-03T10:00:00Z' }),
      ],
    });
    expect(ofType(r, 'routine.run')[0]).toMatchObject({ routine: { id: 'ro1', name: 'R ro1' }, triggeredFrom: 'manual' });
    expect(ofType(r, 'workflow.run')[0]).toMatchObject({ ticket: { id: 't1', title: 'vue agenda' }, workflowName: 'Spec Dev PR (HITL)' });
  });
});

describe('waitSegments', () => {
  it('types a wait at a human_gate step as gate and one at an agent step as question, closing each at the next step event', () => {
    const r = run({ id: 'r', ticketId: 't', start: '2026-11-05T08:00:00Z', end: '2026-11-05T12:00:00Z' });
    const segs = waitSegments(r, [
      ev('workflow.needs_review', '2026-11-05T08:10:00Z', { workflowRunId: 'r', stepId: 'spec' }),
      ev('workflow.step_started', '2026-11-05T08:30:00Z', { workflowRunId: 'r', stepId: 'spec' }),
      ev('workflow.needs_review', '2026-11-05T09:00:00Z', { workflowRunId: 'r', stepId: 'gate' }),
      ev('workflow.step_completed', '2026-11-05T10:00:00Z', { workflowRunId: 'r', stepId: 'gate' }),
    ], W.now);
    expect(segs).toEqual([
      { kind: 'question', stepName: 'Spec', start: '2026-11-05T08:10:00.000Z', end: '2026-11-05T08:30:00.000Z' },
      { kind: 'gate', stepName: 'Check Spec', start: '2026-11-05T09:00:00.000Z', end: '2026-11-05T10:00:00.000Z' },
    ]);
  });

  it('leaves the last wait open while the run is still waiting — so the agenda shows how long it has been waiting', () => {
    const r = run({ id: 'r', ticketId: 't', status: 'needs_review', start: '2026-11-05T00:00:00Z', end: null });
    const segs = waitSegments(r, [ev('workflow.needs_review', '2026-11-05T00:07:00Z', { workflowRunId: 'r', stepId: 'gate' })], W.now);
    expect(segs).toEqual([{ kind: 'gate', stepName: 'Check Spec', start: '2026-11-05T00:07:00.000Z', end: null }]);
  });
});

describe('buildAgenda — routines and production', () => {
  it('lists upcoming slots only from now on, never for a disabled or manual routine', () => {
    const daily = { kind: 'cron' as const, cron: '0 9 * * *', timezone: 'Europe/Paris' };
    const r = build({ routines: [routine('on', daily), routine('off', daily, false), routine('man', { kind: 'manual' })] });
    const up = ofType(r, 'routine.upcoming');
    // Thu 09:00 Paris is before now (11:30) → Fri, Sat, Sun only.
    expect(up.map((i) => i.start)).toEqual(['2026-11-06T08:00:00.000Z', '2026-11-07T08:00:00.000Z', '2026-11-08T08:00:00.000Z']);
    expect(new Set(up.map((i) => i.routine?.id))).toEqual(new Set(['on']));
  });

  it('reports a routine whose upcoming slots hit the cap', () => {
    const r = build({ routines: [routine('fast', { kind: 'cron', cron: '* * * * *', timezone: 'UTC' })] });
    expect(r.truncated).toEqual(['fast']);
    expect(ofType(r, 'routine.upcoming')).toHaveLength(UPCOMING_CAP);
  });

  it('shows an overlap skip under its routine, and ties a merged PR to the ticket that links it', () => {
    const r = build({
      tickets: [ticket({ id: 't764', links: [{ id: 'l', type: 'github_pr', ref: 'oliviermadre/fleex#348', label: '', url: null, createdAt: '' }] })],
      routines: [routine('slack', { kind: 'manual' })],
      events: [
        ev('routine.run_skipped', '2026-11-03T22:30:00Z', { routineId: 'slack', activeRunId: 'old', reason: 'overlap' }),
        ev('pr.merged', '2026-11-04T23:13:23Z', { ref: 'OliviermAdre/fleex#348' }),
        ev('pr.merged', '2026-11-04T23:20:00Z', { ref: 'odys-travel/odys-front#1' }),
      ],
    });
    expect(ofType(r, 'routine.skipped')[0]).toMatchObject({ routine: { id: 'slack' }, runId: 'old' });
    expect(ofType(r, 'pr.merged').map((i) => i.ticket?.id ?? null)).toEqual(['t764', null]);
  });
});

function memoryKv(): KvStorePort {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
    listByPrefix: async () => [],
  };
}

describe('agenda routes', () => {
  async function app(kv: KvStorePort | null = memoryKv()) {
    const a = Fastify();
    const calls: unknown[] = [];
    await a.register(agendaRoutes({ getAgenda: { execute: async (w) => { calls.push(w); return { items: [] } as unknown as AgendaResponse; } }, kvStore: kv }));
    return { a, calls };
  }

  it('refuses an inverted or over-long window with INVALID_RANGE', async () => {
    const { a, calls } = await app();
    const bad = await a.inject({ url: '/api/agenda?from=2026-11-09T00:00:00Z&to=2026-11-02T00:00:00Z' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('INVALID_RANGE');
    expect((await a.inject({ url: '/api/agenda?from=2026-09-01T00:00:00Z&to=2026-11-02T00:00:00Z' })).statusCode).toBe(400);
    expect((await a.inject({ url: '/api/agenda?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z' })).statusCode).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('round-trips prefs so another browser reads what this one saved, and answers defaults before any save', async () => {
    const { a } = await app();
    expect((await a.inject({ url: '/api/agenda/prefs' })).json()).toMatchObject({ view: 'week', labels: {} });
    const prefs = { version: 1, labels: { 'routine.upcoming': false }, routines: { r1: false }, filters: { boards: ['b'], tags: [] }, view: 'month' };
    expect((await a.inject({ method: 'PUT', url: '/api/agenda/prefs', payload: prefs })).statusCode).toBe(200);
    expect((await a.inject({ url: '/api/agenda/prefs' })).json()).toEqual({
      ...prefs, filters: { boards: ['b'], epics: [], repos: [], tags: [] },
      drawerOpen: true, googleCalendars: [], showWorkingLocation: false,
    });
  });

  it('reads prefs saved before the epic / repo / drawer / Google fields with their defaults, and keeps the new ones', () => {
    const old = parseAgendaPrefs({ version: 1, labels: {}, routines: {}, filters: { boards: [], tags: ['x'] }, view: 'week' });
    expect('prefs' in old && old.prefs).toEqual({
      version: 1, labels: {}, routines: {}, filters: { boards: [], epics: [], repos: [], tags: ['x'] }, view: 'week',
      drawerOpen: true, googleCalendars: [], showWorkingLocation: false,
    });
    const full = parseAgendaPrefs({
      labels: { event: false }, routines: {}, filters: { boards: [], epics: ['g1'], repos: ['o/r'], tags: [] }, view: 'day',
      drawerOpen: false, googleCalendars: ['primary', 'team@x'], showWorkingLocation: true,
    });
    expect('prefs' in full && full.prefs).toMatchObject({
      labels: { event: false }, filters: { epics: ['g1'], repos: ['o/r'] }, drawerOpen: false,
      googleCalendars: ['primary', 'team@x'], showWorkingLocation: true,
    });
    expect('error' in parseAgendaPrefs({ labels: {}, routines: {}, filters: { boards: [], tags: [], epics: 'g1' }, view: 'day' })).toBe(true);
    expect('error' in parseAgendaPrefs({ labels: {}, routines: {}, filters: { boards: [], tags: [] }, view: 'day', drawerOpen: 'yes' })).toBe(true);
  });

  it('passes ?calendars=a,b to the use case as calendar ids, and nothing when absent', async () => {
    const seen: unknown[] = [];
    const a = Fastify();
    await a.register(agendaRoutes({
      getAgenda: { execute: async (_w, opts) => { seen.push(opts); return { items: [] } as unknown as AgendaResponse; } },
      kvStore: null,
    }));
    await a.inject({ url: '/api/agenda?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z&calendars=primary,%20team%40x' });
    await a.inject({ url: '/api/agenda?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z' });
    expect(seen).toEqual([{ calendarIds: ['primary', 'team@x'] }, {}]);
  });

  it('lists the deliverables of a run, including the ones only tagged with a step run of it', async () => {
    const dto = (id: string, at: string) => ({ id, createdAt: D(at), toDTO: () => ({ id }) });
    const a = Fastify();
    await a.register(agendaRoutes({
      getAgenda: { execute: async () => ({}) as AgendaResponse },
      kvStore: null,
      deliverableStore: {
        getByWorkflowRun: async (runId: string) => (runId === 'run1' ? [dto('d2', '2026-11-05T10:00:00Z')] : []) as never,
        getByStepRun: async (stepId: string) => (stepId === 's1' ? [dto('d1', '2026-11-05T09:00:00Z'), dto('d2', '2026-11-05T10:00:00Z')] : []) as never,
      },
      stepRunStore: { getByWorkflowRun: async () => [{ id: 's1' }, { id: 's2' }] as never },
    }));
    const res = await a.inject({ url: '/api/agenda/runs/run1/deliverables' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deliverables: [{ id: 'd1' }, { id: 'd2' }] });
  });

  it('answers 501 for run deliverables without a deliverable store', async () => {
    const { a } = await app();
    expect((await a.inject({ url: '/api/agenda/runs/run1/deliverables' })).statusCode).toBe(501);
  });

  it('drops label keys it does not know instead of refusing the save, and refuses a bad view', () => {
    const ok = parseAgendaPrefs({ labels: { 'workflow.gate': true, 'ticket.done': false }, routines: {}, filters: { boards: [], tags: [] }, view: 'day' });
    expect('prefs' in ok && ok.prefs.labels).toEqual({ 'ticket.done': false });
    expect('error' in parseAgendaPrefs({ labels: {}, routines: {}, filters: { boards: [], tags: [] }, view: 'year' })).toBe(true);
  });

  it('answers 501 on storage without a KV store', async () => {
    const { a } = await app(null);
    expect((await a.inject({ url: '/api/agenda/prefs' })).statusCode).toBe(501);
  });
});

describe('buildAgenda — refs, epics, missed slots, free events', () => {
  const calEvent = (over: Partial<CalendarEvent>): CalendarEvent => ({
    id: 'ev1', title: 'Standup', description: null, allDay: false, start: '2026-11-03T09:00:00.000Z', end: '2026-11-03T09:30:00.000Z',
    color: null, ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
  });

  it('fills a ticket ref with its epics and linked repositories, the routine ref with its trigger kind, and lists epics', () => {
    const t = ticket({
      id: 't1', createdAt: '2026-11-03T10:00:00Z',
      links: [
        { id: 'l1', type: 'repository', ref: 'odys-travel/fleex', label: '', url: null, createdAt: '' },
        { id: 'l2', type: 'github_pr', ref: 'odys-travel/fleex#1', label: '', url: null, createdAt: '' },
      ],
    });
    const r = build({
      tickets: [t], routines: [routine('m', { kind: 'manual' })],
      memberships: [{ ticketId: 't1', groupId: 'g2' }, { ticketId: 't1', groupId: 'g1' }, { ticketId: 'other', groupId: 'g1' }],
      epics: [{ id: 'g2', name: 'Zeta' }, { id: 'g1', name: 'Alpha' }],
    });
    expect(ofType(r, 'ticket.created')[0]!.ticket).toMatchObject({ epicIds: ['g2', 'g1'], repos: ['odys-travel/fleex'] });
    expect(r.routines[0]).toMatchObject({ id: 'm', triggerKind: 'manual' });
    expect(r.epics).toEqual([{ id: 'g1', name: 'Alpha' }, { id: 'g2', name: 'Zeta' }]);
    expect(r.errors).toEqual({});
  });

  it('shows the missed slots of a known routine inside the window only', () => {
    const r = build({
      routines: [routine('h', { kind: 'cron', cron: '0 * * * *', timezone: 'UTC' }, false)],
      missedSlots: [
        { routineId: 'h', slotAt: '2026-11-04T02:00:00.000Z', detectedAt: '2026-11-04T04:30:00.000Z', reason: 'scheduler_down' },
        { routineId: 'h', slotAt: '2026-10-20T02:00:00.000Z', detectedAt: '2026-10-20T04:30:00.000Z', reason: 'scheduler_down' },
        { routineId: 'gone', slotAt: '2026-11-04T03:00:00.000Z', detectedAt: '2026-11-04T04:30:00.000Z', reason: 'scheduler_down' },
      ],
    });
    expect(ofType(r, 'routine.missed')).toEqual([expect.objectContaining({
      id: 'routine.missed:h:2026-11-04T02:00:00.000Z', shape: 'point', start: '2026-11-04T02:00:00.000Z',
      missedReason: 'scheduler_down', routine: expect.objectContaining({ id: 'h' }), cron: '0 * * * *',
    })]);
  });

  it('shows a one-off event as a block, a recurring one once per occurrence, and an all-day one with its inclusive last day', () => {
    const r = build({
      tickets: [ticket({ id: 't9' })],
      calendarEvents: [
        calEvent({ id: 'once', ticketId: 't9' }),
        calEvent({ id: 'daily', recurrence: 'daily', start: '2026-10-01T08:00:00.000Z', end: '2026-10-01T08:15:00.000Z', recurrenceUntil: '2026-11-04' }),
        calEvent({ id: 'off', allDay: true, start: '2026-11-05', end: '2026-11-06', title: 'Off' }),
        calEvent({ id: 'old', start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T10:00:00.000Z' }),
      ],
    });
    const evs = ofType(r, 'event');
    expect(evs.find((i) => i.id === 'event:once')).toMatchObject({ shape: 'block', start: '2026-11-03T09:00:00.000Z', end: '2026-11-03T09:30:00.000Z', ticket: { id: 't9' }, event: { id: 'once' } });
    // Window Mon 2 → Sun 8 (Paris); the series stops on Wed 4.
    expect(evs.filter((i) => i.event?.id === 'daily').map((i) => i.id)).toEqual([
      'event:daily:2026-11-02T08:00:00.000Z', 'event:daily:2026-11-03T08:00:00.000Z', 'event:daily:2026-11-04T08:00:00.000Z',
    ]);
    expect(evs.find((i) => i.id === 'event:off')).toMatchObject({ shape: 'allDay', start: '2026-11-05', end: '2026-11-06' });
    expect(evs.some((i) => i.id === 'event:old')).toBe(false);
  });
});

describe('GetAgendaUseCase — sources', () => {
  const kvWith = (rows: Record<string, unknown>): KvStorePort => ({
    get: async () => null, set: async () => {}, delete: async () => {},
    listByPrefix: async (p) => Object.entries(rows).filter(([k]) => k.startsWith(p)).map(([key, v]) => ({ key, value: JSON.stringify(v) })),
  });
  const stores = (tickets: TicketEntity[], routines: RoutineEntity[]) => [
    { getAllTickets: async () => tickets } as never,
    { getAll: async () => routines } as never,
    null, null,
  ] as const;

  it('reads epics once per group, events and missed slots from the KV store, and passes the calendar ids to the external source', async () => {
    const t = ticket({ id: 't1', createdAt: '2026-11-03T10:00:00Z' });
    const g = TicketGroupEntity.create({ id: 'g1', name: 'Agenda' });
    const groupCalls: string[] = [];
    const ticketGroups = {
      getAllTicketGroups: async () => [g],
      getMembershipsByGroup: async (id: string) => { groupCalls.push(id); return [{ ticketId: 't1', groupId: id }]; },
    } as never;
    const kv = kvWith({
      'agenda:event:e1': { id: 'e1', title: 'Demo', description: null, allDay: false, start: '2026-11-04T14:00:00.000Z', end: '2026-11-04T15:00:00.000Z', color: null, ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null, createdAt: '', updatedAt: '' },
      [missedSlotKey('h', '2026-11-04T02:00:00.000Z')]: { routineId: 'h', slotAt: '2026-11-04T02:00:00.000Z', detectedAt: '2026-11-04T04:30:00.000Z', reason: 'scheduler_down' },
    });
    const calls: unknown[] = [];
    const external = { list: async (from: Date, to: Date, ids: string[]) => { calls.push(ids); return [{ id: 'external:x', type: 'external' as const, shape: 'point' as const, start: '2026-11-04T10:00:00.000Z', title: 'Meet' }]; } };
    const uc = new GetAgendaUseCase(...stores([t], [routine('h', { kind: 'cron', cron: '0 * * * *', timezone: 'UTC' })]), external, { ticketGroups, kvStore: kv });
    const r = await uc.execute(W, { calendarIds: ['primary'] });
    expect(groupCalls).toEqual(['g1']);
    expect(r.epics).toEqual([{ id: 'g1', name: 'Agenda' }]);
    expect(ofType(r, 'ticket.created')[0]!.ticket?.epicIds).toEqual(['g1']);
    expect(ofType(r, 'event').map((i) => i.id)).toEqual(['event:e1']);
    expect(ofType(r, 'routine.missed')).toHaveLength(1);
    expect(ofType(r, 'external').map((i) => i.id)).toEqual(['external:x']);
    expect(calls).toEqual([['primary']]);
    expect(r.errors).toEqual({});
  });

  it('keeps the rest of the agenda when the external source fails, and says why in errors.external', async () => {
    const t = ticket({ id: 't1', createdAt: '2026-11-03T10:00:00Z' });
    const external = { list: async () => { throw new Error('Google token expired'); } };
    const r = await new GetAgendaUseCase(...stores([t], []), external).execute(W);
    expect(r.errors).toEqual({ external: 'Google token expired' });
    expect(ofType(r, 'ticket.created')).toHaveLength(1);
  });

  it('reads the workflow.* family from the event log so a run carries its hatched waits (regression: asked for "workflow." → matched nothing)', async () => {
    const t = ticket({ id: 't1', createdAt: '2026-11-03T10:00:00Z' });
    const r1 = run({ id: 'r1', ticketId: 't1', start: '2026-11-05T08:00:00Z', end: '2026-11-05T10:00:00Z' });
    const log = [
      ev('workflow.needs_review', '2026-11-05T08:30:00Z', { workflowRunId: 'r1', stepId: 'gate' }),
      ev('workflow.step_completed', '2026-11-05T09:15:00Z', { workflowRunId: 'r1', stepId: 'gate' }),
    ];
    // Same matching as the sqlite / pg / supabase adapters: `event_type = ? OR event_type LIKE ? || '.%'`.
    const eventLog = {
      list: async ({ eventType }: { eventType?: string }) =>
        log.filter((e) => !eventType || e.eventType === eventType || e.eventType.startsWith(`${eventType}.`)),
    } as never;
    const [tickets, routines] = stores([t], []);
    const res = await new GetAgendaUseCase(tickets, routines, { getAll: async () => [r1] } as never, eventLog).execute(W);
    expect(ofType(res, 'workflow.run')[0]!.segments).toEqual([
      { kind: 'gate', stepName: 'Check Spec', start: '2026-11-05T08:30:00.000Z', end: '2026-11-05T09:15:00.000Z' },
    ]);
  });
});
