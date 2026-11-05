import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { CalendarEvent } from '@fleex/shared';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';
import { expandCalendarEvent, parseCalendarEventInput } from '../../src/application/use-cases/calendar-events.js';
import { calendarEventsRoutes, CALENDAR_EVENT_CHANGED } from '../../src/infrastructure/http/calendar-events.routes.js';

const D = (s: string) => new Date(s);

function memoryKv() {
  const data = new Map<string, string>();
  const kv: KvStorePort & { data: Map<string, string> } = {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
    listByPrefix: async (p) => [...data].filter(([k]) => k.startsWith(p)).map(([key, value]) => ({ key, value })),
  };
  return kv;
}

const series = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e', title: 'T', description: null, allDay: false, start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z',
  color: null, ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null, createdAt: '', updatedAt: '', ...over,
});

describe('expandCalendarEvent', () => {
  it('returns a one-off event only when it overlaps the window (end exclusive)', () => {
    const e = series({});
    expect(expandCalendarEvent(e, D('2026-11-02T09:30:00Z'), D('2026-11-03T00:00:00Z'), 500)).toHaveLength(1);
    expect(expandCalendarEvent(e, D('2026-11-02T10:00:00Z'), D('2026-11-03T00:00:00Z'), 500)).toHaveLength(0);
    expect(expandCalendarEvent(e, D('2026-11-01T00:00:00Z'), D('2026-11-02T09:00:00Z'), 500)).toHaveLength(0);
  });

  it('repeats weekly on the same UTC time and stops at recurrenceUntil (inclusive)', () => {
    const e = series({ recurrence: 'weekly', recurrenceUntil: '2026-11-16' });
    expect(expandCalendarEvent(e, D('2026-11-01T00:00:00Z'), D('2026-12-31T00:00:00Z'), 500)).toEqual([
      { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' },
      { start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T10:00:00.000Z' },
      { start: '2026-11-16T09:00:00.000Z', end: '2026-11-16T10:00:00.000Z' },
    ]);
  });

  it('jumps straight to the window for an old daily series, and caps the occurrences', () => {
    const e = series({ recurrence: 'daily', start: '2020-01-01T09:00:00.000Z', end: '2020-01-01T09:15:00.000Z' });
    const week = expandCalendarEvent(e, D('2026-11-02T00:00:00Z'), D('2026-11-09T00:00:00Z'), 500);
    expect(week.map((o) => o.start.slice(0, 10))).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(expandCalendarEvent(e, D('2026-11-02T00:00:00Z'), D('2026-11-09T00:00:00Z'), 3)).toHaveLength(3);
  });

  it('keeps the day of month monthly and skips the months that lack it', () => {
    const e = series({ recurrence: 'monthly', start: '2026-01-31T09:00:00.000Z', end: '2026-01-31T10:00:00.000Z' });
    const starts = expandCalendarEvent(e, D('2026-01-01T00:00:00Z'), D('2026-06-01T00:00:00Z'), 500).map((o) => o.start.slice(0, 10));
    expect(starts).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('expands an all-day multi-day event with its inclusive last day, and includes one that ends on the first local day', () => {
    const e = series({ allDay: true, start: '2026-11-01', end: '2026-11-02', recurrence: 'weekly' });
    // Paris week Mon 2 → Mon 9 (23:00Z bounds): the 1→2 occurrence touches Monday.
    expect(expandCalendarEvent(e, D('2026-11-01T23:00:00Z'), D('2026-11-08T23:00:00Z'), 500)).toEqual([
      { start: '2026-11-01', end: '2026-11-02' },
      { start: '2026-11-08', end: '2026-11-09' },
    ]);
  });
});

describe('parseCalendarEventInput', () => {
  const ok = { title: '  Demo  ', allDay: false, start: '2026-11-02T09:00:00+01:00', end: '2026-11-02T10:00:00+01:00' };

  it('trims the title, normalises instants and fills the optional fields with null', () => {
    expect(parseCalendarEventInput(ok)).toEqual({ input: {
      title: 'Demo', allDay: false, start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z',
      description: null, color: null, ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null,
    } });
  });

  it.each([
    [{ ...ok, title: '   ' }],
    [{ ...ok, title: 'x'.repeat(121) }],
    [{ ...ok, end: ok.start }],
    [{ ...ok, start: '2026-11-02' }],
    [{ ...ok, allDay: true }],
    [{ ...ok, allDay: true, start: '2026-11-03', end: '2026-11-02' }],
    [{ ...ok, allDay: true, start: '2026-02-30', end: '2026-03-01' }],
    [{ ...ok, recurrence: 'yearly' }],
    [{ ...ok, recurrenceUntil: '2026-11-2' }],
    [{ ...ok, color: 'x'.repeat(21) }],
    [{ ...ok, allDay: 'no' }],
  ])('refuses %j', (body) => {
    expect('error' in parseCalendarEventInput(body)).toBe(true);
  });

  it('accepts an all-day event on one day', () => {
    expect('input' in parseCalendarEventInput({ title: 'Off', allDay: true, start: '2026-11-05', end: '2026-11-05' })).toBe(true);
  });
});

describe('calendar events routes', () => {
  async function app(kv: KvStorePort | null = memoryKv()) {
    const a = Fastify();
    const pushed: { type: string; data: unknown }[] = [];
    let n = 0;
    await a.register(calendarEventsRoutes({
      kvStore: kv, broadcast: (type, data) => pushed.push({ type, data }),
      now: () => D('2026-11-05T10:00:00Z'), newId: () => `id${++n}`,
    }));
    return { a, pushed };
  }
  const body = { title: 'Demo', allDay: false, start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z' };

  it('creates, lists, patches and deletes an event under agenda:event:<id>, pushing a change after each write', async () => {
    const kv = memoryKv();
    const { a, pushed } = await app(kv);
    const created = await a.inject({ method: 'POST', url: '/api/calendar-events', payload: body });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 'id1', title: 'Demo', recurrence: null, createdAt: '2026-11-05T10:00:00.000Z' });
    expect(JSON.parse(kv.data.get('agenda:event:id1')!)).toMatchObject({ id: 'id1' });

    expect((await a.inject({ url: '/api/calendar-events' })).json()).toHaveLength(1);

    const patched = await a.inject({ method: 'PATCH', url: '/api/calendar-events/id1', payload: { title: 'Demo v2', recurrence: 'weekly' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ title: 'Demo v2', recurrence: 'weekly', start: '2026-11-02T09:00:00.000Z' });

    expect((await a.inject({ method: 'PATCH', url: '/api/calendar-events/id1', payload: { end: '2026-11-02T08:00:00Z' } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'DELETE', url: '/api/calendar-events/id1' })).statusCode).toBe(204);
    expect(kv.data.has('agenda:event:id1')).toBe(false);

    expect(pushed).toEqual([
      { type: CALENDAR_EVENT_CHANGED, data: { id: 'id1', action: 'created' } },
      { type: CALENDAR_EVENT_CHANGED, data: { id: 'id1', action: 'updated' } },
      { type: CALENDAR_EVENT_CHANGED, data: { id: 'id1', action: 'deleted' } },
    ]);
  });

  it('answers 400 on a bad body, 404 on an unknown id and 501 without a KV store', async () => {
    const { a } = await app();
    const bad = await a.inject({ method: 'POST', url: '/api/calendar-events', payload: { ...body, title: '' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/title/);
    expect((await a.inject({ method: 'PATCH', url: '/api/calendar-events/nope', payload: { title: 'x' } })).statusCode).toBe(404);
    expect((await a.inject({ method: 'DELETE', url: '/api/calendar-events/nope' })).statusCode).toBe(404);
    const { a: none } = await app(null);
    expect((await none.inject({ url: '/api/calendar-events' })).statusCode).toBe(501);
    expect((await none.inject({ method: 'POST', url: '/api/calendar-events', payload: body })).statusCode).toBe(501);
  });
});
