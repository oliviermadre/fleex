/**
 * Headless agenda reads: windows, item refs, the shared filter / attendee /
 * title rules, and the long-range search around today.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/core/api.ts', () => ({ apiBase: () => 'http://localhost:1234' }));

import {
  agendaItemLinkKey, decodeAgendaItemRef, encodeAgendaItemRef, matchAttendee, matchesAttendee, substringDistance, type AgendaItem, type AgendaResponse,
} from '@fleex/shared';
import {
  addDays, dayKey, itemMatchKind, itemMatches, pickMatches, resolveWindow, searchAgenda, searchChunks, startOfDay, type ItemFilter,
} from '../../src/commands/agenda/_read.ts';
import { matchMeetings } from '../../src/commands/agenda/link/index.ts';

// Thu 5 Nov 2026, 10:30 local.
const NOW = new Date(2026, 10, 5, 10, 30);

const meeting = (over: Partial<AgendaItem> & { key?: string } = {}): AgendaItem => ({
  id: `external:${over.key ?? 'uid1'}`, type: 'external', shape: 'block',
  start: new Date(2026, 10, 5, 14).toISOString(), end: new Date(2026, 10, 5, 15).toISOString(), title: 'Daily',
  external: {
    calendarId: 'primary', eventKey: over.key ?? 'uid1', htmlLink: null, attendees: 2, location: null, eventType: 'default', links: [],
    organizer: { email: 'alex@example.com', name: 'Alex Martin', self: true },
    attendeeList: [{ email: 'jb@example.com', name: 'Jean-Baptiste Durand', response: 'accepted', organizer: false, self: false, optional: false }],
  },
  ...over,
});

const NO_FILTER: ItemFilter = { types: null, boards: [], epics: [], repos: [], tags: [], routines: [], q: null, attendee: null };

describe('resolveWindow', () => {
  it('reads shortcuts as local days and weeks from Monday', () => {
    const w = resolveWindow({ when: 'tomorrow' }, NOW);
    expect('from' in w && [dayKey(w.from), dayKey(w.to)]).toEqual(['2026-11-06', '2026-11-07']);
    const lw = resolveWindow({ when: 'last-week' }, NOW);
    expect('from' in lw && [dayKey(lw.from), dayKey(lw.to)]).toEqual(['2026-10-26', '2026-11-02']);
    const none = resolveWindow({}, NOW);
    expect('from' in none && dayKey(none.from)).toBe('2026-11-05');
  });

  it('takes --to as an inclusive day, and refuses mixed or too-long windows', () => {
    const w = resolveWindow({ from: '2026-11-02', to: '2026-11-08' }, NOW);
    expect('from' in w && dayKey(w.to)).toBe('2026-11-09');
    expect(resolveWindow({ when: 'week', from: '2026-11-02' }, NOW)).toEqual({ error: expect.stringContaining('not both') });
    expect(resolveWindow({ from: '2026-01-01', to: '2026-06-01' }, NOW)).toEqual({ error: expect.stringContaining('agenda search') });
    expect(resolveWindow({ from: 'soon' }, NOW)).toEqual({ error: expect.stringContaining('--from') });
  });
});

describe('item refs', () => {
  it('round-trip the id and start, shell-safe, for every kind of item', () => {
    const it0 = meeting({ key: 'abc@google.com|2026-11-05T13:00:00.000Z' });
    const ref = encodeAgendaItemRef(it0);
    expect(ref).toMatch(/^ag_[A-Za-z0-9_-]+$/);
    expect(decodeAgendaItemRef(ref)).toEqual({ id: it0.id, start: it0.start });
    expect(decodeAgendaItemRef('event:123')).toBeNull();
    expect(decodeAgendaItemRef('ag_!!!')).toBeNull();
  });

  it('a free event links by its occurrence key, a Google meeting by its event key', () => {
    const ev = {
      id: 'e1', title: 'Weekly', description: null, allDay: false, start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T09:30:00.000Z',
      color: null, ticketId: null, epicId: null, recurrence: 'weekly' as const, recurrenceUntil: null, createdAt: '', updatedAt: '',
    };
    const occ: AgendaItem = { id: 'event:e1:2026-11-09T09:00:00.000Z', type: 'event', shape: 'block', start: '2026-11-09T09:00:00.000Z', title: 'Weekly', event: ev };
    expect(agendaItemLinkKey(occ)).toBe('fleex-event:e1|2026-11-09T09:00:00.000Z');
    expect(agendaItemLinkKey(meeting())).toBe('uid1');
    expect(agendaItemLinkKey({ ...meeting(), type: 'ticket.due', external: null })).toBeNull();
  });
});

describe('filters', () => {
  it('finds a meeting by a part of a guest name, accents and case ignored, or by email', () => {
    expect(matchesAttendee(meeting(), 'jean-baptiste')).toBe(true);
    expect(matchesAttendee(meeting(), 'JEAN BAPTISTE')).toBe(true);
    expect(matchesAttendee(meeting(), 'jb@example')).toBe(true);
    expect(matchesAttendee(meeting(), 'alex')).toBe(true); // organizer
    expect(matchesAttendee(meeting(), 'marie')).toBe(false);
    const nameless = meeting({ external: { ...meeting().external!, attendeeList: [{ email: 'jeanbaptiste@example.com', name: null, response: 'accepted', organizer: false, self: false, optional: false }] } });
    expect(matchesAttendee(nameless, 'Jean-Baptiste')).toBe(true);
  });

  it('combines types, routines, the sidebar filters and the search box', () => {
    const run: AgendaItem = { id: 'routine.run:r', type: 'routine.run', shape: 'block', start: NOW.toISOString(), title: 'Wispr sync', routine: { id: 'r1', name: 'Wispr sync', emoji: '' } };
    expect(itemMatches(run, { ...NO_FILTER, types: ['external'] })).toBe(false);
    expect(itemMatches(run, { ...NO_FILTER, routines: ['wispr sync'] })).toBe(true);
    expect(itemMatches(run, { ...NO_FILTER, routines: ['other'] })).toBe(false);
    expect(itemMatches(run, { ...NO_FILTER, boards: ['b1'] })).toBe(true); // no board → the filter does not hide it
    expect(itemMatches(run, { ...NO_FILTER, q: 'wispr' })).toBe(true);
    expect(itemMatches(run, { ...NO_FILTER, attendee: 'jean' })).toBe(false);
  });
});

describe('approximate guest match (typos)', () => {
  const nameless = (email: string) => meeting({ key: email, external: { ...meeting().external!, organizer: null, attendeeList: [{ email, name: null, response: 'accepted', organizer: false, self: false, optional: false }] } });

  it('measures typos against the closest part of a name', () => {
    expect(substringDistance('jonbaptiste', 'jeanbaptiste')).toBe(2);
    expect(substringDistance('baptiste', 'jeanbaptistedurand')).toBe(0);
  });

  it('finds Jean-Baptiste from "Jon-Baptiste", flagged approximate, never from a short or distant name', () => {
    const jb = nameless('jeanbaptiste@example.com');
    expect(matchAttendee(jb, 'Jon-Baptiste')).toBeNull();
    expect(matchAttendee(jb, 'Jon-Baptiste', true)).toEqual({ attendee: 'jeanbaptiste@example.com', approximate: true });
    expect(matchAttendee(jb, 'Jean-Baptiste', true)).toEqual({ attendee: 'jeanbaptiste@example.com', approximate: false });
    expect(matchAttendee(jb, 'jon', true)).toBeNull(); // under 5 letters: no tolerance
    expect(matchAttendee(jb, 'exampla', true)).toBeNull(); // the email domain is never a near miss
    expect(matchAttendee(jb, 'Guillaume', true)).toBeNull();
  });

  it('keeps exact matches when there are any, else returns the near ones flagged', () => {
    const f = { ...NO_FILTER, attendee: 'Jon-Baptiste' };
    const jb = nameless('jeanbaptiste@example.com');
    const paul = nameless('jon.baptiste@example.com');
    expect(itemMatchKind(jb, f)).toBe('approx');
    expect(itemMatches(jb, f)).toBe(false);
    expect(pickMatches([jb, paul], f)).toEqual({ items: [paul], approximate: false });
    expect(pickMatches([jb], f)).toEqual({ items: [jb], approximate: true });
    expect(pickMatches([jb], { ...f, attendee: 'zorro' })).toEqual({ items: [], approximate: false });
  });
});

describe('matchMeetings (link --match-title)', () => {
  it('matches Google meetings and free events, exact title first, each meeting once', () => {
    const ev: AgendaItem = {
      id: 'event:e2', type: 'event', shape: 'block', start: NOW.toISOString(), title: 'Daily review',
      event: { id: 'e2', title: 'Daily review', description: null, allDay: false, start: NOW.toISOString(), end: NOW.toISOString(), color: null, ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null, createdAt: '', updatedAt: '' },
    };
    const twice = [meeting(), { ...meeting(), external: { ...meeting().external!, calendarId: 'team' } }];
    expect(matchMeetings([...twice, ev], 'daily').map((i) => i.id)).toEqual(['external:uid1']);
    expect(matchMeetings([...twice, ev], 'review').map((i) => i.id)).toEqual(['event:e2']);
    expect(matchMeetings([{ ...meeting(), type: 'ticket.created', external: null }], 'daily')).toEqual([]);
  });
});

describe('long-range search', () => {
  const range = { since: addDays(startOfDay(NOW), -365), until: addDays(startOfDay(NOW), 92) };

  it('cuts the range into ≤ 42-day windows, ring by ring away from today, both sides', () => {
    const rings = searchChunks(range, NOW);
    const all = rings.flat();
    for (const w of all) expect(w.to.getTime() - w.from.getTime()).toBeLessThanOrEqual(42 * 86_400_000 + 3600_000);
    expect(rings[0]!.map((w) => [dayKey(w.from), dayKey(w.to)])).toEqual([['2026-11-05', '2026-12-17'], ['2026-09-24', '2026-11-05']]);
    expect(all[all.length - 1]!.from.getTime()).toBe(range.since.getTime());
    expect(Math.max(...all.map((w) => w.to.getTime()))).toBe(range.until.getTime());
    // Only the past: rings start at the end of the range.
    const past = searchChunks({ since: new Date(2026, 0, 1), until: new Date(2026, 1, 1) }, NOW);
    expect(dayKey(past[0]![0]!.to)).toBe('2026-02-01');
  });

  it('scans the whole range when only near spellings match, and returns them flagged', async () => {
    const fetchFn = vi.fn(async (from: Date): Promise<AgendaResponse> => ({
      from: '', to: '', generatedAt: '', routines: [], truncated: [], epics: [], errors: {},
      items: [meeting({ key: `k-${dayKey(from)}`, start: addDays(from, 3).toISOString() })],
    }));
    const out = await searchAgenda(() => 'approx', range, 2, [], NOW, fetchFn);
    expect(out.approximate).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(fetchFn.mock.calls.length).toBe(searchChunks(range, NOW).flat().length);
  });

  it('stops once the limit is in hand, nearest first, and says what it covered', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (from: Date, to: Date): Promise<AgendaResponse> => {
      calls.push(dayKey(from));
      const items = [meeting({ key: `k-${dayKey(from)}`, start: addDays(from, 3).toISOString() })];
      return { from: '', to: '', generatedAt: '', items, routines: [], truncated: [], epics: [], errors: {} };
    });
    const out = await searchAgenda(() => true, range, 3, [], NOW, fetchFn);
    expect(out.items).toHaveLength(3);
    expect(calls).toHaveLength(4); // two rings of two windows
    expect(out.items.map((i) => dayKey(new Date(i.start)))).toEqual(['2026-11-08', '2026-09-27', '2026-12-20']);
    expect(dayKey(out.covered.since)).toBe('2026-08-13');
    expect(dayKey(out.covered.until)).toBe('2027-01-28');
  });
});
