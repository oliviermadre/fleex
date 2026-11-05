import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';
import {
  GoogleCalendarClient,
  GogNotInstalledError,
  GoogleNotConnectedError,
  type GogResult,
} from '../../src/infrastructure/google/google-calendar.client.js';
import { GoogleAgendaSource, mapGoogleEvent, dayBefore } from '../../src/infrastructure/google/google-agenda.source.js';
import {
  ExternalLinksStore,
  eventKeyOf,
  findMeeting,
  normalizeTitle,
  titlesMatch,
  wisprflowIdOf,
} from '../../src/infrastructure/google/external-links.js';
import { googleAgendaRoutes, localDayWindow } from '../../src/infrastructure/http/google-agenda.routes.js';
import { createGoogleAgenda } from '../../src/infrastructure/google/index.js';

function memoryKv(): KvStorePort & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
    listByPrefix: async (p) => [...data].filter(([k]) => k.startsWith(p)).map(([key, value]) => ({ key, value })),
  };
}

/** A fake `gog`: records each argv, answers from `handler` (gog's not_found envelope by default). */
function fakeGog(handler: (args: string[]) => GogResult | undefined = () => undefined) {
  const calls: string[][] = [];
  const run = async (args: string[]): Promise<GogResult> => {
    calls.push(args);
    return handler(args) ?? { code: 5, stdout: JSON.stringify({ error: { class: 'not_found', code: 5, message: 'not found' } }), stderr: '' };
  };
  return { run, calls };
}

const ok = (json: unknown): GogResult => ({ code: 0, stdout: JSON.stringify(json), stderr: '' });
/** What gog 0.47 answers with no OAuth client stored. */
const NO_CREDENTIALS: GogResult = {
  code: 10,
  stdout: JSON.stringify({ error: { class: 'config', code: 10, message: 'OAuth client credentials missing (OAuth client ID JSON).' } }),
  stderr: 'OAuth client credentials missing (OAuth client ID JSON).',
};
/** What gog 0.47 answers with credentials but no authorized account. */
const NO_ACCOUNT: GogResult = {
  code: 2,
  stdout: JSON.stringify({ error: { class: 'usage', code: 2, message: 'missing --account (or set GOG_ACCOUNT, set default via `gog auth manage`, or store exactly one token)' } }),
  stderr: '',
};
/** The gog subcommand, without the global flags Fleex prepends. */
const cmd = (args: string[]) => args.slice(args.indexOf('calendar'));
const isCmd = (args: string[], name: string) => args.includes('calendar') && cmd(args)[1] === name;

const NOW = Date.UTC(2026, 10, 5, 9, 0, 0);
const CALENDARS = [{ id: 'me@example.com', summary: 'Me', primary: true }, { id: 'team', summary: 'Team', summaryOverride: 'My team' }];

/** gog installed and authorized: version, calendars, and whatever `extra` answers. */
const connected = (extra: (args: string[]) => GogResult | undefined = () => undefined) => (args: string[]) => {
  if (args[0] === '--version') return { code: 0, stdout: 'v0.47.1 (cbb7f01f 2026-10-27T02:50:07Z)\n', stderr: '' };
  if (isCmd(args, 'calendars')) return ok({ calendars: CALENDARS, nextPageToken: '' });
  return extra(args);
};

function client(run: (args: string[]) => Promise<GogResult>, now = () => NOW, account: string | null = null) {
  return new GoogleCalendarClient({ run, now, account, bin: 'gog' });
}

const deliverables = new Map([
  ['d1', { id: 'd1', title: 'Standup notes' }],
  ['d2', { id: 'd2', title: 'Recap (Wisprflow id = abc123)' }],
  ['d3', { id: 'd3', title: 'Transcript (Wisprflow id = abc123)' }],
]);
const deliverableStore = { getById: async (id: string) => (deliverables.get(id) ?? null) as never };

// ── Mapping ──

describe('mapGoogleEvent', () => {
  it('maps a timed event to a block with ISO bounds, attendees, location and link', () => {
    const item = mapGoogleEvent({
      id: 'e1',
      iCalUID: 'uid1@google.com',
      summary: 'Weekly sync',
      start: { dateTime: '2026-11-05T10:00:00+01:00' },
      end: { dateTime: '2026-11-05T11:00:00+01:00' },
      htmlLink: 'https://calendar.google.com/event?eid=1',
      location: 'Room 4',
      attendees: [{ email: 'a', self: true, responseStatus: 'accepted' }, { email: 'b' }, { email: 'room', resource: true }],
    }, 'primary');
    expect(item).toMatchObject({
      id: 'external:uid1@google.com',
      type: 'external',
      shape: 'block',
      start: '2026-11-05T09:00:00.000Z',
      end: '2026-11-05T10:00:00.000Z',
      title: 'Weekly sync',
      status: 'accepted',
      external: {
        calendarId: 'primary',
        eventKey: 'uid1@google.com',
        htmlLink: 'https://calendar.google.com/event?eid=1',
        attendees: 2,
        location: 'Room 4',
        eventType: 'default',
        links: [],
      },
    });
  });

  it('turns Google\'s exclusive all-day end into an inclusive last day', () => {
    const one = mapGoogleEvent({ id: 'a', iCalUID: 'a', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } }, 'primary');
    expect(one).toMatchObject({ shape: 'allDay', start: '2026-11-05', end: '2026-11-05' });
    const three = mapGoogleEvent({ id: 'b', iCalUID: 'b', start: { date: '2026-11-29' }, end: { date: '2026-12-02' } }, 'primary');
    expect(three).toMatchObject({ start: '2026-11-29', end: '2026-12-01' });
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
  });

  it('keys one occurrence of a recurring meeting by iCalUID + original start', () => {
    const occurrence: GoogleCalendarEvent = {
      id: 'series_20261105T090000Z',
      iCalUID: 'series@google.com',
      recurringEventId: 'series',
      originalStartTime: { dateTime: '2026-11-05T10:00:00+01:00' },
      start: { dateTime: '2026-11-05T11:00:00+01:00' }, // moved, the key keeps the original slot
      end: { dateTime: '2026-11-05T11:30:00+01:00' },
      summary: 'Standup',
    };
    expect(eventKeyOf(occurrence)).toBe('series@google.com|2026-11-05T09:00:00.000Z');
    expect(mapGoogleEvent(occurrence, 'primary')!.id).toBe('external:series@google.com|2026-11-05T09:00:00.000Z');
    expect(eventKeyOf({ id: 'x', iCalUID: 'allday@g', recurringEventId: 'x', originalStartTime: { date: '2026-11-05' } }))
      .toBe('allday@g|2026-11-05');
  });

  it('skips cancelled events, defaults the title and keeps the event type', () => {
    expect(mapGoogleEvent({ id: 'c', status: 'cancelled', start: { dateTime: '2026-11-05T10:00:00Z' } }, 'primary')).toBeNull();
    const ooo = mapGoogleEvent({ id: 'o', iCalUID: 'o', eventType: 'outOfOffice', start: { dateTime: '2026-11-05T10:00:00Z' }, end: { dateTime: '2026-11-05T12:00:00Z' } }, 'primary');
    expect(ooo).toMatchObject({ title: '(no title)', external: { eventType: 'outOfOffice' } });
  });
});

// ── Client (gogcli) ──

describe('GoogleCalendarClient (gogcli)', () => {
  it('runs gog read-only, JSON, never prompting, with the configured account', async () => {
    const { run, calls } = fakeGog(connected());
    await client(run, () => NOW, 'me@example.com').listCalendars();
    expect(calls[0]).toEqual(['--json', '--no-input', '--readonly', '--color=never', '--account', 'me@example.com', 'calendar', 'calendars', '--all']);
  });

  it('lists events of one calendar over [from, to), all pages, and caches the window 5 minutes', async () => {
    let t = NOW;
    const { run, calls } = fakeGog((args) => (isCmd(args, 'events') ? ok({ events: [{ id: 'a' }, { id: 'b' }], nextPageToken: '' }) : undefined));
    const c = client(run, () => t);
    const from = new Date('2026-11-02T00:00:00Z');
    const to = new Date('2026-11-09T00:00:00Z');
    expect((await c.listEvents('team@group.calendar.google.com', from, to)).map((e) => e.id)).toEqual(['a', 'b']);
    expect(cmd(calls[0]!)).toEqual([
      'calendar', 'events', 'team@group.calendar.google.com', '--from', from.toISOString(), '--to', to.toISOString(), '--all-pages', '--max', '250',
    ]);
    await c.listEvents('team@group.calendar.google.com', from, to);
    expect(calls).toHaveLength(1);
    t += 5 * 60_000;
    await c.listEvents('team@group.calendar.google.com', from, to);
    expect(calls).toHaveLength(2);
  });

  it('turns gog\'s setup errors (no OAuth client, no account, auth required) into GoogleNotConnectedError with gog\'s message', async () => {
    for (const res of [NO_CREDENTIALS, NO_ACCOUNT, { code: 4, stdout: '', stderr: 'auth required\n' }]) {
      const { run } = fakeGog(() => res);
      const err = await client(run).listCalendars().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GoogleNotConnectedError);
      expect((err as Error).message).not.toBe('');
    }
    const { run } = fakeGog(() => NO_CREDENTIALS);
    expect(await client(run).isConnected()).toBe(false);
  });

  it('reports a missing binary as GogNotInstalledError, and version() as null', async () => {
    const { run } = fakeGog(() => ({ code: 127, stdout: '', stderr: '', notFound: true }));
    await expect(client(run).listCalendars()).rejects.toBeInstanceOf(GogNotInstalledError);
    expect(await client(run).version()).toBeNull();
  });

  it('getEvent: the event (bare or wrapped), null on not_found, an API error otherwise', async () => {
    const event = { id: 'e1', summary: 'Sync' };
    const { run } = fakeGog((args) => {
      if (!isCmd(args, 'event')) return undefined;
      const id = cmd(args)[3];
      if (id === 'e1') return ok(event);
      if (id === 'e2') return ok({ event: { ...event, id: 'e2' } });
      if (id === 'boom') return { code: 7, stdout: JSON.stringify({ error: { class: 'rate_limited', message: 'slow down' } }), stderr: '' };
      return undefined;
    });
    const c = client(run);
    expect(await c.getEvent('primary', 'e1')).toEqual(event);
    expect((await c.getEvent('primary', 'e2'))?.id).toBe('e2');
    expect(await c.getEvent('primary', 'nope')).toBeNull();
    await expect(c.getEvent('primary', 'boom')).rejects.toMatchObject({ name: 'GoogleApiError', status: 429 });
  });
});

// ── Source ──

describe('GoogleAgendaSource', () => {
  it('returns nothing when gogcli is not installed or not set up', async () => {
    const kv = memoryKv();
    for (const res of [NO_CREDENTIALS, { code: 127, stdout: '', stderr: '', notFound: true } as GogResult]) {
      const source = new GoogleAgendaSource(client(fakeGog(() => res).run), new ExternalLinksStore(kv));
      expect(await source.list(new Date(NOW), new Date(NOW + 86400_000), [])).toEqual([]);
    }
  });

  it('reads the primary calendar by default, attaches links, skips cancelled and dedupes shared meetings', async () => {
    const kv = memoryKv();
    const links = new ExternalLinksStore(kv);
    await links.create({ eventKey: 'uid1', deliverableId: 'd1', deliverableTitle: 'Standup notes', eventTitle: 'Sync', eventStart: '2026-11-05T09:00:00.000Z', source: 'manual' });
    const event = { id: 'e1', iCalUID: 'uid1', summary: 'Sync', start: { dateTime: '2026-11-05T09:00:00Z' }, end: { dateTime: '2026-11-05T10:00:00Z' } };
    const { run, calls } = fakeGog((args) => (isCmd(args, 'events')
      ? ok({ events: [event, { id: 'x', status: 'cancelled', start: { dateTime: '2026-11-05T11:00:00Z' } }] })
      : undefined));
    const items = await new GoogleAgendaSource(client(run), links).list(new Date(NOW), new Date(NOW + 86400_000), []);
    expect(cmd(calls[0]!)[2]).toBe('primary');
    expect(items).toHaveLength(1);
    expect(items[0]!.external!.links.map((l) => l.deliverableId)).toEqual(['d1']);

    const both = await new GoogleAgendaSource(client(run), links).list(new Date(NOW), new Date(NOW + 86400_000), ['primary', 'team']);
    expect(both).toHaveLength(1);
  });

  it('throws on a gog API failure so the agenda reports it', async () => {
    const { run } = fakeGog(() => ({ code: 1, stdout: JSON.stringify({ error: { class: 'error', message: 'backend error' } }), stderr: '' }));
    const source = new GoogleAgendaSource(client(run), new ExternalLinksStore(memoryKv()));
    await expect(source.list(new Date(NOW), new Date(NOW + 86400_000), [])).rejects.toThrow(/backend error/);
  });
});

// ── Links and title matching ──

describe('external links', () => {
  it('is idempotent on (eventKey, deliverableId)', async () => {
    const store = new ExternalLinksStore(memoryKv());
    const input = { eventKey: 'k', deliverableId: 'd1', deliverableTitle: 'T', eventTitle: 'E', eventStart: '2026-11-05', source: 'manual' as const };
    const a = await store.create(input);
    const b = await store.create(input);
    expect(a.created).toBe(true);
    expect(b).toEqual({ link: a.link, created: false });
    expect(await store.list()).toHaveLength(1);
    expect(await store.delete(a.link.id)).toBe(true);
    expect(await store.delete(a.link.id)).toBe(false);
  });

  it('returns the existing link when the meeting already has a deliverable of the same Wisprflow meeting', async () => {
    const store = new ExternalLinksStore(memoryKv());
    const base = { eventKey: 'k', eventTitle: 'E', eventStart: '2026-11-05', source: 'cli' as const };
    const first = await store.create({ ...base, deliverableId: 'd2', deliverableTitle: 'Recap (Wisprflow id = abc123)' });
    const twin = await store.create({ ...base, deliverableId: 'd3', deliverableTitle: 'Transcript (Wisprflow id = abc123)' });
    expect(twin).toEqual({ link: first.link, created: false });
    const other = await store.create({ ...base, eventKey: 'other', deliverableId: 'd3', deliverableTitle: 'Transcript (Wisprflow id = abc123)' });
    expect(other.created).toBe(true);
    expect(wisprflowIdOf('x (Wisprflow ID = Zz-9)')).toBe('Zz-9');
    expect(wisprflowIdOf('no id')).toBeNull();
  });

  it('normalises titles (case, accents, emojis, punctuation, spaces) and matches either way', () => {
    expect(normalizeTitle('  🚀 Réunion  d\'équipe — Q4!! ')).toBe('reunion d equipe q4');
    expect(titlesMatch('Réunion d’équipe', 'reunion d equipe — hebdo')).toBe(true);
    expect(titlesMatch('Weekly product sync', 'product SYNC')).toBe(true);
    expect(titlesMatch('Standup', 'Retro')).toBe(false);
    expect(titlesMatch('🎉', 'Party')).toBe(false);
  });

  it('findMeeting prefers exact matches and ignores cancelled events', () => {
    const events: GoogleCalendarEvent[] = [
      { id: '1', iCalUID: '1', summary: 'Sync' },
      { id: '2', iCalUID: '2', summary: 'Sync — design' },
      { id: '3', iCalUID: '3', summary: 'Sync', status: 'cancelled' },
    ];
    expect(findMeeting(events, 'sync').map((e) => e.id)).toEqual(['1']);
    expect(findMeeting(events, 'design').map((e) => e.id)).toEqual(['2']);
    expect(findMeeting(events, 'retro')).toEqual([]);
  });

  it('localDayWindow is the server-local day', () => {
    const w = localDayWindow('2026-11-05')!;
    expect(w.from.getDate()).toBe(5);
    expect(w.from.getHours()).toBe(0);
    expect(w.to.getTime() - w.from.getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(localDayWindow('2026-02-30')).toBeNull();
  });
});

// ── Routes ──

describe('google agenda routes', () => {
  async function appWith(kv: KvStorePort | null, handler: (args: string[]) => GogResult | undefined = () => undefined) {
    const { run, calls } = fakeGog(handler);
    const c = kv ? client(run) : null;
    const app = Fastify();
    await app.register(googleAgendaRoutes({ kvStore: kv, deliverableStore, client: c, now: () => new Date(NOW) }));
    return { app, calls };
  }
  const status = async (app: Awaited<ReturnType<typeof appWith>>['app'], q = '') => (await app.inject({ method: 'GET', url: `/api/agenda/google/status${q}` })).json();

  it('answers 501 everywhere without a KV store', async () => {
    const { app } = await appWith(null);
    for (const [method, url] of [
      ['GET', '/api/agenda/google/status'], ['GET', '/api/agenda/external-links'], ['POST', '/api/agenda/external-links'],
      ['DELETE', '/api/agenda/external-links/x'], ['POST', '/api/agenda/google/link'],
    ] as const) {
      expect((await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })).statusCode, `${method} ${url}`).toBe(501);
    }
  });

  it('has no OAuth connect / disconnect routes any more: gogcli is set up outside Fleex', async () => {
    const { app } = await appWith(memoryKv(), connected());
    for (const [method, url] of [['GET', '/auth/google-calendar'], ['GET', '/auth/google-calendar/callback'], ['DELETE', '/api/agenda/google']] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('status: gog not installed → installed false, with the setup link', async () => {
    const { app } = await appWith(memoryKv(), () => ({ code: 127, stdout: '', stderr: '', notFound: true }));
    expect(await status(app)).toEqual({
      provider: 'gogcli', installed: false, version: null, connected: false, email: null, calendars: [], error: null,
      setupUrl: 'https://gogcli.sh/quickstart.html',
    });
  });

  it('status: installed but not set up → connected false with gog\'s own message', async () => {
    const { app } = await appWith(memoryKv(), (args) => (args[0] === '--version' ? { code: 0, stdout: 'v0.47.1 (x)', stderr: '' } : NO_CREDENTIALS));
    expect(await status(app)).toMatchObject({ installed: true, version: 'v0.47.1', connected: false, error: 'OAuth client credentials missing (OAuth client ID JSON).' });
  });

  it('status: connected → calendars and the account (primary calendar id); ?refresh=1 bypasses the cache', async () => {
    let calendars = CALENDARS;
    const { app, calls } = await appWith(memoryKv(), (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'v0.47.1 (x)', stderr: '' };
      return isCmd(args, 'calendars') ? ok({ calendars }) : undefined;
    });
    expect(await status(app)).toEqual({
      provider: 'gogcli', installed: true, version: 'v0.47.1', connected: true, email: 'me@example.com', error: null,
      setupUrl: 'https://gogcli.sh/quickstart.html',
      calendars: [{ id: 'me@example.com', name: 'Me', primary: true }, { id: 'team', name: 'My team', primary: false }],
    });
    calendars = [CALENDARS[0]!];
    expect((await status(app)).calendars).toHaveLength(2);
    expect((await status(app, '?refresh=1')).calendars).toHaveLength(1);
    expect(calls.filter((a) => isCmd(a, 'calendars'))).toHaveLength(2);
  });

  it('status: a gog API failure once set up stays connected, with the error', async () => {
    const { app } = await appWith(memoryKv(), (args) => (args[0] === '--version'
      ? { code: 0, stdout: 'v0.47.1', stderr: '' }
      : { code: 8, stdout: JSON.stringify({ error: { class: 'retryable', message: 'backend unavailable' } }), stderr: '' }));
    expect(await status(app)).toMatchObject({ connected: true, calendars: [], error: expect.stringContaining('backend unavailable') });
  });

  it('external links: create (201, then 200 idempotent), 404 unknown deliverable, list with filters, delete', async () => {
    const { app } = await appWith(memoryKv());
    const body = { eventKey: 'k1', deliverableId: 'd1', eventTitle: 'Sync', eventStart: '2026-11-05T09:00:00.000Z' };
    const created = await app.inject({ method: 'POST', url: '/api/agenda/external-links', payload: body });
    expect(created.statusCode).toBe(201);
    const link = created.json();
    expect(link).toMatchObject({ provider: 'google', eventKey: 'k1', deliverableId: 'd1', deliverableTitle: 'Standup notes', source: 'manual', createdAt: new Date(NOW).toISOString() });
    const again = await app.inject({ method: 'POST', url: '/api/agenda/external-links', payload: body });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(link.id);
    expect((await app.inject({ method: 'POST', url: '/api/agenda/external-links', payload: { ...body, deliverableId: 'nope' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/agenda/external-links', payload: { deliverableId: 'd1' } })).statusCode).toBe(400);
    await app.inject({ method: 'POST', url: '/api/agenda/external-links', payload: { ...body, eventKey: 'k2' } });

    expect((await app.inject({ method: 'GET', url: '/api/agenda/external-links' })).json().links).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/api/agenda/external-links?eventKey=k2' })).json().links).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/agenda/external-links?deliverableId=d9' })).json().links).toHaveLength(0);

    expect((await app.inject({ method: 'DELETE', url: `/api/agenda/external-links/${link.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/agenda/external-links/${link.id}` })).statusCode).toBe(404);
  });

  describe('POST /api/agenda/google/link', () => {
    const occurrence = {
      id: 'series_20261105T090000Z',
      iCalUID: 'series@google.com',
      recurringEventId: 'series',
      originalStartTime: { dateTime: '2026-11-05T09:00:00Z' },
      summary: '☕ Daily Stand-up',
      start: { dateTime: '2026-11-05T09:00:00Z' },
      end: { dateTime: '2026-11-05T09:15:00Z' },
    };

    it('409 GOOGLE_NOT_CONNECTED (with the gogcli setup link) when gog is not set up, 404 for an unknown deliverable', async () => {
      const { app } = await appWith(memoryKv(), () => NO_ACCOUNT);
      const res = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', googleEventId: 'x' } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'GOOGLE_NOT_CONNECTED', setupUrl: 'https://gogcli.sh/quickstart.html' });
      expect(res.json().error).toContain('gogcli');
      const missing = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'zz', googleEventId: 'x' } });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().code).toBe('DELIVERABLE_NOT_FOUND');
      expect((await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', matchTitle: 'x' } })).statusCode).toBe(400);
    });

    it('links by Google event id (events.get on the calendar), source cli, occurrence key', async () => {
      const { app, calls } = await appWith(memoryKv(), connected((args) => (isCmd(args, 'event') && cmd(args)[2] === 'team' && cmd(args)[3] === occurrence.id ? ok(occurrence) : undefined)));
      const res = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', googleEventId: occurrence.id, calendarId: 'team' } });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        eventKey: 'series@google.com|2026-11-05T09:00:00.000Z', source: 'cli', eventTitle: '☕ Daily Stand-up',
        eventStart: '2026-11-05T09:00:00.000Z', deliverableTitle: 'Standup notes',
      });
      expect(calls).toHaveLength(1);
      expect(cmd(calls[0]!)).toEqual(['calendar', 'event', 'team', occurrence.id]);
      const unknown = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', googleEventId: 'nope', calendarId: 'team' } });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().code).toBe('EVENT_NOT_FOUND');
    });

    it('links by date + normalised title, and dedupes deliverables of the same Wisprflow meeting', async () => {
      const { app, calls } = await appWith(memoryKv(), connected((args) => (isCmd(args, 'events') && cmd(args)[2] === 'primary'
        ? ok({ events: [occurrence, { id: 'o', iCalUID: 'o', summary: 'Retro', start: { dateTime: '2026-11-05T15:00:00Z' } }] })
        : undefined)));
      const first = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd2', matchTitle: 'daily standup', date: '2026-11-05' } });
      expect(first.statusCode).toBe(201);
      const w = localDayWindow('2026-11-05')!;
      expect(cmd(calls[0]!).slice(3, 7)).toEqual(['--from', w.from.toISOString(), '--to', w.to.toISOString()]);

      const twin = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd3', matchTitle: 'Daily Stand-up', date: '2026-11-05' } });
      expect(twin.statusCode).toBe(200);
      expect(twin.json().id).toBe(first.json().id);
      expect(twin.json().deliverableId).toBe('d2');

      const none = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', matchTitle: 'Board meeting', date: '2026-11-05' } });
      expect(none.statusCode).toBe(404);
      expect(none.json().code).toBe('EVENT_NOT_FOUND');
    });

    it('409 AMBIGUOUS_EVENT with candidates when several meetings match', async () => {
      const { app } = await appWith(memoryKv(), connected((args) => (isCmd(args, 'events')
        ? ok({ events: [{ id: 'a', iCalUID: 'a', summary: 'Sync product' }, { id: 'b', iCalUID: 'b', summary: 'Sync design' }] })
        : undefined)));
      const res = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', matchTitle: 'sync', date: '2026-11-05' } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'AMBIGUOUS_EVENT', candidates: [{ googleEventId: 'a' }, { googleEventId: 'b' }] });
    });
  });

  it('createGoogleAgenda wires routes and a source on a KV store, and degrades without one', async () => {
    const withKv = createGoogleAgenda({ kvStore: memoryKv(), deliverableStore, client: client(fakeGog(connected()).run) });
    expect(withKv.source).toBeInstanceOf(GoogleAgendaSource);
    const without = createGoogleAgenda({ kvStore: null, deliverableStore });
    expect(without.source).toBeNull();
    const app = Fastify();
    await app.register(without.routes);
    expect((await app.inject({ method: 'GET', url: '/api/agenda/google/status' })).statusCode).toBe(501);
  });
});
