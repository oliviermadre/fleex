import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';
import {
  GoogleCalendarClient,
  GOOGLE_TOKENS_KEY,
  emailFromIdToken,
  type GoogleCalendarEvent,
  type GoogleTokens,
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
import { googleAgendaRoutes, localDayWindow, safeReturnOrigin } from '../../src/infrastructure/http/google-agenda.routes.js';
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

type Call = { url: string; method: string; body: string | null; headers: Record<string, string> };
type Handler = (call: Call) => { status?: number; json?: unknown } | undefined;

/** A fetch that records calls and answers from `handler` (404 by default). */
function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const res = handler(call) ?? { status: 404, json: { error: { message: 'not found' } } };
    return new Response(JSON.stringify(res.json ?? {}), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}

const NOW = Date.UTC(2026, 10, 5, 9, 0, 0);
const creds = () => ({ clientId: 'cid', clientSecret: 'secret' });

function tokens(over: Partial<GoogleTokens> = {}): GoogleTokens {
  return { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 3600_000, email: 'me@example.com', scope: 'calendar.readonly', ...over };
}

async function connectedKv(over: Partial<GoogleTokens> = {}) {
  const kv = memoryKv();
  await kv.set(GOOGLE_TOKENS_KEY, JSON.stringify(tokens(over)));
  return kv;
}

function client(kv: KvStorePort, fetchFn: typeof fetch, now = () => NOW) {
  return new GoogleCalendarClient({ kvStore: kv, fetch: fetchFn, now, credentials: creds });
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

// ── Client ──

describe('GoogleCalendarClient', () => {
  it('refreshes the access token a minute before it expires, keeping the refresh token', async () => {
    const kv = await connectedKv({ expiresAt: NOW + 30_000 });
    const { fn, calls } = mockFetch((c) => {
      if (c.url === 'https://oauth2.googleapis.com/token') return { json: { access_token: 'at-2', expires_in: 3599 } };
      if (c.url.includes('/calendarList')) return { json: { items: [{ id: 'primary', summary: 'Me', primary: true }] } };
      return undefined;
    });
    const cal = await client(kv, fn).listCalendars();
    expect(cal).toHaveLength(1);
    const refresh = calls[0]!;
    expect(refresh.method).toBe('POST');
    const form = new URLSearchParams(refresh.body!);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('rt-1');
    expect(calls[1]!.headers['Authorization']).toBe('Bearer at-2');
    const stored = JSON.parse(kv.data.get(GOOGLE_TOKENS_KEY)!) as GoogleTokens;
    expect(stored).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-1', expiresAt: NOW + 3599_000 });
  });

  it('does not refresh a token valid for more than a minute', async () => {
    const kv = await connectedKv({ expiresAt: NOW + 120_000 });
    const { fn, calls } = mockFetch((c) => (c.url.includes('/calendarList') ? { json: { items: [] } } : undefined));
    await client(kv, fn).listCalendars();
    expect(calls.map((c) => c.url)).toEqual([expect.stringContaining('/calendarList')]);
  });

  it('drops the tokens when Google refuses the refresh token (invalid_grant)', async () => {
    const kv = await connectedKv({ expiresAt: NOW - 1 });
    const { fn } = mockFetch(() => ({ status: 400, json: { error: 'invalid_grant' } }));
    await expect(client(kv, fn).listCalendars()).rejects.toMatchObject({ name: 'GoogleNotConnectedError' });
    expect(kv.data.has(GOOGLE_TOKENS_KEY)).toBe(false);
  });

  it('lists events page by page with the expected query and caches the window 5 minutes', async () => {
    const kv = await connectedKv();
    let t = NOW;
    const { fn, calls } = mockFetch((c) => {
      const url = new URL(c.url);
      if (!url.pathname.endsWith('/events')) return undefined;
      return url.searchParams.get('pageToken') === 'p2'
        ? { json: { items: [{ id: 'b' }] } }
        : { json: { items: [{ id: 'a' }], nextPageToken: 'p2' } };
    });
    const c = client(kv, fn, () => t);
    const from = new Date('2026-11-02T00:00:00Z');
    const to = new Date('2026-11-09T00:00:00Z');
    expect((await c.listEvents('team@group.calendar.google.com', from, to)).map((e) => e.id)).toEqual(['a', 'b']);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe('/calendar/v3/calendars/team%40group.calendar.google.com/events');
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      singleEvents: 'true', orderBy: 'startTime', timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '250',
    });
    await c.listEvents('team@group.calendar.google.com', from, to);
    expect(calls).toHaveLength(2);
    t += 5 * 60_000;
    await c.listEvents('team@group.calendar.google.com', from, to);
    expect(calls).toHaveLength(4);
  });

  it('exchanges a code (form-encoded) and reads the email from the id_token', async () => {
    const kv = memoryKv();
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'olivier@example.com' })).toString('base64url')}.sig`;
    const { fn, calls } = mockFetch(() => ({ json: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken, scope: 's' } }));
    const t = await client(kv, fn).exchangeCode('the-code', 'http://localhost:3000/auth/google-calendar/callback');
    expect(t).toMatchObject({ accessToken: 'at', refreshToken: 'rt', email: 'olivier@example.com', expiresAt: NOW + 3600_000 });
    expect(calls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(calls[0]!.body!);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(kv.data.has(GOOGLE_TOKENS_KEY)).toBe(true);
    expect(emailFromIdToken('garbage')).toBeNull();
  });

  it('revokes and forgets the tokens on disconnect', async () => {
    const kv = await connectedKv();
    const { fn, calls } = mockFetch(() => ({ json: {} }));
    await client(kv, fn).disconnect();
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(new URLSearchParams(calls[0]!.body!).get('token')).toBe('rt-1');
    expect(kv.data.has(GOOGLE_TOKENS_KEY)).toBe(false);
  });
});

// ── Source ──

describe('GoogleAgendaSource', () => {
  it('returns nothing when Google is not connected', async () => {
    const kv = memoryKv();
    const { fn, calls } = mockFetch(() => undefined);
    const source = new GoogleAgendaSource(client(kv, fn), new ExternalLinksStore(kv));
    expect(await source.list(new Date(NOW), new Date(NOW + 86400_000), [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('reads the primary calendar by default, attaches links, skips cancelled and dedupes shared meetings', async () => {
    const kv = await connectedKv();
    const links = new ExternalLinksStore(kv);
    await links.create({ eventKey: 'uid1', deliverableId: 'd1', deliverableTitle: 'Standup notes', eventTitle: 'Sync', eventStart: '2026-11-05T09:00:00.000Z', source: 'manual' });
    const event = { id: 'e1', iCalUID: 'uid1', summary: 'Sync', start: { dateTime: '2026-11-05T09:00:00Z' }, end: { dateTime: '2026-11-05T10:00:00Z' } };
    const { fn, calls } = mockFetch((c) => (c.url.includes('/events')
      ? { json: { items: [event, { id: 'x', status: 'cancelled', start: { dateTime: '2026-11-05T11:00:00Z' } }] } }
      : undefined));
    const source = new GoogleAgendaSource(client(kv, fn), links);
    const items = await source.list(new Date(NOW), new Date(NOW + 86400_000), []);
    expect(calls[0]!.url).toContain('/calendars/primary/events');
    expect(items).toHaveLength(1);
    expect(items[0]!.external!.links.map((l) => l.deliverableId)).toEqual(['d1']);

    const both = await new GoogleAgendaSource(client(kv, fn), links).list(new Date(NOW), new Date(NOW + 86400_000), ['primary', 'team']);
    expect(both).toHaveLength(1);
  });

  it('throws on an API failure so the agenda reports it', async () => {
    const kv = await connectedKv();
    const { fn } = mockFetch(() => ({ status: 500, json: { error: { message: 'backend error' } } }));
    const source = new GoogleAgendaSource(client(kv, fn), new ExternalLinksStore(kv));
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

  it('localDayWindow is the server-local day; safeReturnOrigin only trusts loopback', () => {
    const w = localDayWindow('2026-11-05')!;
    expect(w.from.getDate()).toBe(5);
    expect(w.from.getHours()).toBe(0);
    expect(w.to.getTime() - w.from.getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(localDayWindow('2026-02-30')).toBeNull();
    expect(safeReturnOrigin('http://localhost:5173/agenda')).toBe('http://localhost:5173');
    expect(safeReturnOrigin('https://evil.example.com/')).toBe('');
    expect(safeReturnOrigin('javascript:alert(1)')).toBe('');
  });
});

// ── Routes ──

describe('google agenda routes', () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env['AUTH_CALLBACK_BASE_URL'];
    delete process.env['PORT'];
  });
  afterEach(() => {
    process.env = { ...env };
  });

  async function appWith(kv: KvStorePort | null, handler: Handler = () => undefined) {
    const { fn, calls } = mockFetch(handler);
    const c = kv ? client(kv, fn) : null;
    const app = Fastify();
    await app.register(googleAgendaRoutes({ kvStore: kv, deliverableStore, client: c, now: () => new Date(NOW) }));
    return { app, calls };
  }

  it('answers 501 everywhere without a KV store', async () => {
    const { app } = await appWith(null);
    for (const [method, url] of [
      ['GET', '/api/agenda/google/status'], ['GET', '/auth/google-calendar'], ['GET', '/auth/google-calendar/callback'],
      ['DELETE', '/api/agenda/google'], ['GET', '/api/agenda/external-links'], ['POST', '/api/agenda/external-links'],
      ['DELETE', '/api/agenda/external-links/x'], ['POST', '/api/agenda/google/link'],
    ] as const) {
      expect((await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })).statusCode, `${method} ${url}`).toBe(501);
    }
  });

  it('status: disconnected, then connected with calendars, then calendars [] on an API error', async () => {
    const kv = memoryKv();
    let fail = false;
    const { app } = await appWith(kv, (c) => {
      if (!c.url.includes('/calendarList')) return undefined;
      return fail ? { status: 500, json: {} } : { json: { items: [{ id: 'primary', summary: 'Me', primary: true }, { id: 'team', summary: 'Team', summaryOverride: 'My team' }] } };
    });
    expect((await app.inject({ method: 'GET', url: '/api/agenda/google/status' })).json())
      .toEqual({ configured: true, connected: false, email: null, calendars: [] });
    await kv.set(GOOGLE_TOKENS_KEY, JSON.stringify(tokens()));
    expect((await app.inject({ method: 'GET', url: '/api/agenda/google/status' })).json()).toEqual({
      configured: true, connected: true, email: 'me@example.com',
      calendars: [{ id: 'primary', name: 'Me', primary: true }, { id: 'team', name: 'My team', primary: false }],
    });

    const { app: failing } = await appWith(kv, (c) => (c.url.includes('/calendarList') ? { status: 500, json: {} } : undefined));
    fail = true;
    expect((await failing.inject({ method: 'GET', url: '/api/agenda/google/status' })).json())
      .toMatchObject({ connected: true, calendars: [] });
  });

  it('connect redirects to the consent screen with offline access and a state cookie; the callback stores the tokens', async () => {
    const kv = memoryKv();
    const { app, calls } = await appWith(kv, (c) => (c.url === 'https://oauth2.googleapis.com/token'
      ? { json: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } }
      : c.url.includes('userinfo') ? { json: { email: 'u@example.com' } } : undefined));

    const start = await app.inject({ method: 'GET', url: '/auth/google-calendar', headers: { referer: 'http://localhost:5173/agenda' } });
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: 'cid',
      scope: 'https://www.googleapis.com/auth/calendar.readonly openid email',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      redirect_uri: 'http://localhost:3000/auth/google-calendar/callback',
    });
    const state = location.searchParams.get('state')!;
    const cookies = ([] as string[]).concat(start.headers['set-cookie'] as string[]);
    const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
    expect(cookieHeader).toContain(`fleex_gcal_state=${state}`);

    const bad = await app.inject({ method: 'GET', url: '/auth/google-calendar/callback?code=c&state=nope', headers: { cookie: cookieHeader } });
    expect(bad.headers.location).toBe('http://localhost:5173/agenda?google_error=state_mismatch');

    const ok = await app.inject({ method: 'GET', url: `/auth/google-calendar/callback?code=c&state=${state}`, headers: { cookie: cookieHeader } });
    expect(ok.headers.location).toBe('http://localhost:5173/agenda?google=connected');
    expect(JSON.parse(kv.data.get(GOOGLE_TOKENS_KEY)!)).toMatchObject({ accessToken: 'at', refreshToken: 'rt', email: 'u@example.com' });
    expect(new URLSearchParams(calls.find((c) => c.method === 'POST')!.body!).get('grant_type')).toBe('authorization_code');

    const denied = await app.inject({ method: 'GET', url: '/auth/google-calendar/callback?error=access_denied' });
    expect(denied.headers.location).toBe('/agenda?google_error=access_denied');
  });

  it('DELETE /api/agenda/google revokes and forgets the tokens', async () => {
    const kv = await connectedKv();
    const { app, calls } = await appWith(kv, () => ({ json: {} }));
    expect((await app.inject({ method: 'DELETE', url: '/api/agenda/google' })).statusCode).toBe(204);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(kv.data.has(GOOGLE_TOKENS_KEY)).toBe(false);
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

    it('409 GOOGLE_NOT_CONNECTED when not connected, 404 for an unknown deliverable', async () => {
      const { app } = await appWith(memoryKv());
      const res = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', googleEventId: 'x' } });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('GOOGLE_NOT_CONNECTED');
      const missing = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'zz', googleEventId: 'x' } });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().code).toBe('DELIVERABLE_NOT_FOUND');
      expect((await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', matchTitle: 'x' } })).statusCode).toBe(400);
    });

    it('links by Google event id (events.get on the calendar), source cli, occurrence key', async () => {
      const { app, calls } = await appWith(await connectedKv(), (c) => (c.url.endsWith('/calendars/team/events/series_20261105T090000Z') ? { json: occurrence } : undefined));
      const res = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', googleEventId: occurrence.id, calendarId: 'team' } });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        eventKey: 'series@google.com|2026-11-05T09:00:00.000Z', source: 'cli', eventTitle: '☕ Daily Stand-up',
        eventStart: '2026-11-05T09:00:00.000Z', deliverableTitle: 'Standup notes',
      });
      expect(calls).toHaveLength(1);
      const unknown = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', googleEventId: 'nope', calendarId: 'team' } });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().code).toBe('EVENT_NOT_FOUND');
    });

    it('links by date + normalised title, and dedupes deliverables of the same Wisprflow meeting', async () => {
      const { app, calls } = await appWith(await connectedKv(), (c) => (c.url.includes('/calendars/primary/events')
        ? { json: { items: [occurrence, { id: 'o', iCalUID: 'o', summary: 'Retro', start: { dateTime: '2026-11-05T15:00:00Z' } }] } }
        : undefined));
      const first = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd2', matchTitle: 'daily standup', date: '2026-11-05' } });
      expect(first.statusCode).toBe(201);
      const url = new URL(calls[0]!.url);
      const w = localDayWindow('2026-11-05')!;
      expect(url.searchParams.get('timeMin')).toBe(w.from.toISOString());
      expect(url.searchParams.get('timeMax')).toBe(w.to.toISOString());

      const twin = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd3', matchTitle: 'Daily Stand-up', date: '2026-11-05' } });
      expect(twin.statusCode).toBe(200);
      expect(twin.json().id).toBe(first.json().id);
      expect(twin.json().deliverableId).toBe('d2');

      const none = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', matchTitle: 'Board meeting', date: '2026-11-05' } });
      expect(none.statusCode).toBe(404);
      expect(none.json().code).toBe('EVENT_NOT_FOUND');
    });

    it('409 AMBIGUOUS_EVENT with candidates when several meetings match', async () => {
      const { app } = await appWith(await connectedKv(), (c) => (c.url.includes('/events')
        ? { json: { items: [{ id: 'a', iCalUID: 'a', summary: 'Sync product' }, { id: 'b', iCalUID: 'b', summary: 'Sync design' }] } }
        : undefined));
      const res = await app.inject({ method: 'POST', url: '/api/agenda/google/link', payload: { deliverableId: 'd1', matchTitle: 'sync', date: '2026-11-05' } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'AMBIGUOUS_EVENT', candidates: [{ googleEventId: 'a' }, { googleEventId: 'b' }] });
    });
  });

  it('createGoogleAgenda wires routes and a source on a KV store, and degrades without one', async () => {
    const withKv = createGoogleAgenda({ kvStore: memoryKv(), deliverableStore });
    expect(withKv.source).toBeInstanceOf(GoogleAgendaSource);
    const without = createGoogleAgenda({ kvStore: null, deliverableStore });
    expect(without.source).toBeNull();
    const app = Fastify();
    await app.register(without.routes);
    expect((await app.inject({ method: 'GET', url: '/api/agenda/google/status' })).statusCode).toBe(501);
  });
});
