/**
 * Google meetings on /agenda: what the card shows (Meet link, notes, guests,
 * my answer) and answering an invitation through gogcli (the one write Fleex
 * does to Google).
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';
import { GoogleCalendarClient, type GogResult } from '../../src/infrastructure/google/google-calendar.client.js';
import { attendeesOf, mapGoogleEvent, meetUrlOf, notesToText } from '../../src/infrastructure/google/google-agenda.source.js';
import { googleAgendaRoutes } from '../../src/infrastructure/http/google-agenda.routes.js';

const ok = (json: unknown): GogResult => ({ code: 0, stdout: JSON.stringify(json), stderr: '' });
const NOW = Date.UTC(2026, 10, 5, 9, 0, 0);

function memoryKv(): KvStorePort {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
    listByPrefix: async (p) => [...data].filter(([k]) => k.startsWith(p)).map(([key, value]) => ({ key, value })),
  };
}

const MEETING = {
  id: 'evt_20261105',
  iCalUID: 'weekly@google.com',
  summary: 'Weekly sync',
  start: { dateTime: '2026-11-05T10:00:00+01:00' },
  end: { dateTime: '2026-11-05T11:00:00+01:00' },
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  description: 'Agenda:<br><ul><li>Roadmap</li><li>Hiring</li></ul>Doc: <a href="https://docs.example/x">the doc</a> &amp; more',
  organizer: { email: 'alex@example.com', displayName: 'Alex' },
  attendees: [
    { email: 'zoe@example.com', displayName: 'Zoé', responseStatus: 'declined' },
    { email: 'me@example.com', self: true, responseStatus: 'needsAction' },
    { email: 'room@resource.calendar.google.com', resource: true, responseStatus: 'accepted' },
    { email: 'alex@example.com', displayName: 'Alex', organizer: true, responseStatus: 'accepted' },
    { email: 'bob@example.com', responseStatus: 'tentative', optional: true },
  ],
};

describe('Google meeting details', () => {
  it('maps the Meet link, the notes as text, the guests (organizer, me, then by answer) and my pending answer', () => {
    const item = mapGoogleEvent(MEETING, 'primary');
    const ext = item!.external!;
    expect(ext.eventId).toBe('evt_20261105');
    expect(ext.meetUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(ext.description).toBe('Agenda:\n\n• Roadmap\n• Hiring\nDoc: the doc (https://docs.example/x) & more');
    expect(ext.organizer).toEqual({ email: 'alex@example.com', name: 'Alex', self: false });
    expect(ext.attendees).toBe(4);
    expect(ext.attendeeList!.map((a) => [a.email, a.response])).toEqual([
      ['alex@example.com', 'accepted'],
      ['me@example.com', 'needsAction'],
      ['bob@example.com', 'tentative'],
      ['zoe@example.com', 'declined'],
    ]);
    expect(ext.attendeeList![2]!.optional).toBe(true);
    // A pending invitation must be answerable, or the agenda can't change it.
    expect(ext.rsvp).toBe('needsAction');
    expect(ext.canRespond).toBe(true);
  });

  it('has nothing to answer on my own meeting or a meeting I am not invited to', () => {
    const mine = mapGoogleEvent({ ...MEETING, organizer: { email: 'me@example.com', self: true }, attendees: [{ email: 'me@example.com', self: true, organizer: true, responseStatus: 'accepted' }] }, 'primary');
    expect(mine!.external!.rsvp).toBeNull();
    expect(mine!.external!.canRespond).toBe(false);
    const notInvited = mapGoogleEvent({ ...MEETING, attendees: undefined }, 'team');
    expect(notInvited!.external!.rsvp).toBeNull();
    expect(notInvited!.external!.attendeeList).toEqual([]);
  });

  it('falls back to a conference video entry (Zoom, Teams) when there is no Meet link', () => {
    expect(meetUrlOf({ id: 'x', conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+33' }, { entryPointType: 'video', uri: 'https://zoom.us/j/1' }] } })).toBe('https://zoom.us/j/1');
    expect(meetUrlOf({ id: 'x' })).toBeNull();
  });

  it('notesToText drops tags, decodes entities and keeps nothing for empty notes', () => {
    expect(notesToText('<b>Hello</b>&nbsp;world &#233;t&#xE9;')).toBe('Hello world été');
    expect(notesToText('<a href="https://x.y">https://x.y</a>')).toBe('https://x.y');
    expect(notesToText('<br><br>')).toBeNull();
    expect(notesToText(undefined)).toBeNull();
  });

  it('attendeesOf skips rooms and guests without an email', () => {
    expect(attendeesOf({ id: 'x', attendees: [{ resource: true, email: 'r' }, { displayName: 'No mail' }] })).toEqual([]);
  });
});

describe('POST /api/agenda/google/respond', () => {
  async function appWith(handler: (args: string[]) => GogResult) {
    const calls: string[][] = [];
    const c = new GoogleCalendarClient({ run: async (args) => { calls.push(args); return handler(args); }, now: () => NOW, account: null, bin: 'gog' });
    const app = Fastify();
    await app.register(googleAgendaRoutes({ kvStore: memoryKv(), deliverableStore: { getById: async () => null }, client: c }));
    return { app, calls, client: c };
  }
  const post = (app: Awaited<ReturnType<typeof appWith>>['app'], payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/agenda/google/respond', payload: payload as object });

  it('runs gog calendar respond WITHOUT --readonly, then reads fresh events', async () => {
    let answered = false;
    const { app, calls, client } = await appWith((args) => {
      if (args.includes('respond')) { answered = true; return ok({ status: 'accepted' }); }
      return ok({ events: [{ ...MEETING, attendees: [{ email: 'me@example.com', self: true, responseStatus: answered ? 'accepted' : 'needsAction' }] }] });
    });
    const from = new Date(NOW), to = new Date(NOW + 86_400_000);
    expect((await client.listEvents('primary', from, to))[0]!.attendees![0]!.responseStatus).toBe('needsAction');

    const res = await post(app, { calendarId: 'primary', eventId: 'evt_20261105', status: 'accepted' });
    expect(res.statusCode).toBe(200);
    const respond = calls.find((a) => a.includes('respond'))!;
    expect(respond).not.toContain('--readonly');
    expect(respond.slice(respond.indexOf('calendar'))).toEqual(['calendar', 'respond', 'primary', 'evt_20261105', '--status', 'accepted']);
    // The 5-minute event cache must not hide the new answer.
    expect((await client.listEvents('primary', from, to))[0]!.attendees![0]!.responseStatus).toBe('accepted');
    // Reads stay read-only.
    expect(calls.filter((a) => a.includes('events')).every((a) => a.includes('--readonly'))).toBe(true);
  });

  it('400 on a missing id or an unknown status', async () => {
    const { app, calls } = await appWith(() => ok({}));
    expect((await post(app, { calendarId: 'primary', status: 'accepted' })).statusCode).toBe(400);
    expect((await post(app, { calendarId: 'primary', eventId: 'e', status: 'needsAction' })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('409 GOOGLE_WRITE_NOT_AUTHORIZED with the re-auth command when gog only has read-only access', async () => {
    const { app } = await appWith(() => ({ code: 6, stdout: JSON.stringify({ error: { class: 'permission_denied', message: 'Request had insufficient authentication scopes.' } }), stderr: '' }));
    const res = await post(app, { calendarId: 'primary', eventId: 'e', status: 'declined' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'GOOGLE_WRITE_NOT_AUTHORIZED' });
    expect(res.json().error).toContain('without --readonly');
  });

  it('404 when Google does not know the event', async () => {
    const { app } = await appWith(() => ({ code: 5, stdout: JSON.stringify({ error: { class: 'not_found', message: 'not found' } }), stderr: '' }));
    expect((await post(app, { calendarId: 'primary', eventId: 'gone', status: 'tentative' })).statusCode).toBe(404);
  });
});
