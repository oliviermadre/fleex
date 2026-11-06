/**
 * `fleex agenda link|unlink|links`: flag validation, the request sent to the
 * server, and the actionable message for each error code it answers with.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/core/api.ts', () => ({ apiBase: () => 'http://localhost:1234' }));

import { setJsonMode } from '../../src/core/colors.ts';
import linkDef, { buildLinkBody } from '../../src/commands/agenda/link/index.ts';
import linksDef from '../../src/commands/agenda/links/index.ts';
import { AgendaApiError, agendaRequest, describeAgendaError } from '../../src/commands/agenda/_shared.ts';

const link = {
  id: 'l1', provider: 'google', eventKey: 'uid|2026-11-05T09:00:00.000Z', deliverableId: 'd1', deliverableTitle: 'Notes',
  eventTitle: 'Daily', eventStart: '2026-11-05T09:00:00.000Z', source: 'cli', createdAt: '2026-11-05T10:00:00.000Z',
};

function respond(status: number, json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('buildLinkBody', () => {
  it('needs a deliverable and exactly one way to find the meeting', () => {
    expect(buildLinkBody({ googleEvent: 'e' })).toEqual({ error: expect.stringContaining('--deliverable') });
    expect(buildLinkBody({ deliverable: 'd1' })).toEqual({ error: expect.stringContaining('--google-event') });
    expect(buildLinkBody({ deliverable: 'd1', matchTitle: 'Daily' })).toEqual({ error: expect.stringContaining('--date') });
    expect(buildLinkBody({ deliverable: 'd1', googleEvent: 'e', date: '2026-11-05' })).toEqual({ error: expect.stringContaining('not both') });
    expect(buildLinkBody({ deliverable: 'd1', matchTitle: 'Daily', date: '05/11/2026' })).toEqual({ error: expect.stringContaining('YYYY-MM-DD') });
  });

  it('maps the flags to the API body', () => {
    expect(buildLinkBody({ deliverable: 'd1', googleEvent: 'e1', calendar: 'team' }))
      .toEqual({ body: { deliverableId: 'd1', googleEventId: 'e1', calendarId: 'team' } });
    expect(buildLinkBody({ deliverable: 'd1', matchTitle: 'Daily', date: '2026-11-05' }))
      .toEqual({ body: { deliverableId: 'd1', matchTitle: 'Daily', date: '2026-11-05' } });
  });
});

describe('agendaRequest / describeAgendaError', () => {
  it('keeps the server code and turns it into an actionable message', async () => {
    const notConnected = await agendaRequest('POST', 'http://x', {}, respond(409, { error: 'nope', code: 'GOOGLE_NOT_CONNECTED' }) as never)
      .catch((e: unknown) => e);
    expect(notConnected).toBeInstanceOf(AgendaApiError);
    expect(describeAgendaError(notConnected)).toMatch(/gogcli.*not set up.*gogcli\.sh\/quickstart/i);

    const ambiguous = new AgendaApiError('2 meetings match', 409, 'AMBIGUOUS_EVENT', [
      { googleEventId: 'a', title: 'Sync A', start: '2026-11-05T09:00:00.000Z' },
      { googleEventId: 'b', title: 'Sync B', start: '2026-11-05T10:00:00.000Z' },
    ]);
    expect(describeAgendaError(ambiguous)).toContain('a  2026-11-05T09:00:00.000Z  Sync A');
    expect(describeAgendaError(new AgendaApiError('No meeting', 404, 'EVENT_NOT_FOUND'))).toMatch(/^Meeting not found: No meeting/);
    expect(describeAgendaError(new AgendaApiError('boom', 500, null))).toBe('API error (HTTP 500): boom');
  });
});

describe('commands', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { out.push(String(s)); return true; });
    setJsonMode(true);
  });
  afterEach(() => {
    setJsonMode(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('link --google-event posts to /api/agenda/google/link and reports created', async () => {
    const fetchMock = respond(201, link);
    vi.stubGlobal('fetch', fetchMock);
    await linkDef.action({ deliverable: 'd1', googleEvent: 'e1', calendar: 'team' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:1234/api/agenda/google/link');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ deliverableId: 'd1', googleEventId: 'e1', calendarId: 'team' });
    expect(JSON.parse(out.join(''))).toEqual({ ok: true, created: true, link });
  });

  it('link --match-title finds the meeting in the agenda of that day (calendars from the prefs) and links it', async () => {
    const daily = {
      id: 'external:uid', type: 'external', shape: 'block', start: '2026-11-05T09:00:00.000Z', end: '2026-11-05T09:15:00.000Z', title: 'Daily',
      external: { calendarId: 'team', eventKey: 'uid', htmlLink: null, attendees: 0, location: null, eventType: 'default', links: [] },
    };
    const fetchMock = vi.fn(async (url: string) => {
      const json = url.includes('/api/agenda/prefs') ? { googleCalendars: ['team'] }
        : url.includes('/api/agenda?') ? { items: [daily], errors: {} }
        : link;
      return new Response(JSON.stringify(json), { status: url.includes('external-links') ? 201 : 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await linkDef.action({ deliverable: 'd1', matchTitle: 'daily', date: '2026-11-05' });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.find((u) => u.includes('/api/agenda?'))).toContain('calendars=team');
    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/agenda/external-links'))!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      eventKey: 'uid', deliverableId: 'd1', eventTitle: 'Daily', eventStart: '2026-11-05T09:00:00.000Z', source: 'cli',
    });
    expect(JSON.parse(out.join(''))).toEqual({ ok: true, created: true, link });
  });

  it('link exits with the not-connected message', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'x', code: 'GOOGLE_NOT_CONNECTED' }));
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
    await expect(linkDef.action({ deliverable: 'd1', googleEvent: 'e1' })).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(out.join(''))).toMatchObject({ ok: false, error: expect.stringMatching(/gogcli/i) });
  });

  it('links filters by deliverable', async () => {
    const fetchMock = respond(200, { links: [link] });
    vi.stubGlobal('fetch', fetchMock);
    await linksDef.action({ deliverable: 'd1' });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://localhost:1234/api/agenda/external-links?deliverableId=d1');
    expect(JSON.parse(out.join(''))).toEqual({ ok: true, links: [link] });
  });
});
