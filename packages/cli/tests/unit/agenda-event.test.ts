/** `fleex agenda event create|update`: options → the calendar-events API body. */
import { describe, it, expect } from 'vitest';
import type { CalendarEvent } from '@fleex/shared';
import { buildEventInput, parseDuration, resolveEventId } from '../../src/commands/agenda/event/_shared.ts';
import { encodeAgendaItemRef } from '@fleex/shared';

const base = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', title: 'Sync', description: 'notes', allDay: false,
  start: '2026-11-07T13:00:00.000Z', end: '2026-11-07T14:30:00.000Z',
  color: 'teal', ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null, createdAt: '', updatedAt: '', ...over,
});

describe('parseDuration', () => {
  it('reads minutes, hours and both', () => {
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('30m')).toBe(30);
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('1h30')).toBe(90);
    expect(parseDuration('soon')).toBeNull();
  });
});

describe('buildEventInput — create', () => {
  it('a timed event from --start and --duration', () => {
    const r = buildEventInput({ title: ' Offsite ', start: '2026-11-07T14:00:00Z', duration: '1h30', repeat: 'weekly', until: '2026-12-31' }, null);
    expect(r).toEqual({ input: {
      title: 'Offsite', allDay: false, start: '2026-11-07T14:00:00.000Z', end: '2026-11-07T15:30:00.000Z', recurrence: 'weekly', recurrenceUntil: '2026-12-31',
    } });
  });

  it('an all-day event, one day by default', () => {
    expect(buildEventInput({ title: 'Off', allDay: true, date: '2026-11-10' }, null))
      .toEqual({ input: { title: 'Off', allDay: true, start: '2026-11-10', end: '2026-11-10' } });
    expect(buildEventInput({ title: 'Off', date: '2026-11-10', lastDay: '2026-11-12' }, null))
      .toEqual({ input: { title: 'Off', allDay: true, start: '2026-11-10', end: '2026-11-12' } });
  });

  it('says what is missing or wrong', () => {
    expect(buildEventInput({ start: '2026-11-07T14:00', duration: '1h' }, null)).toEqual({ error: expect.stringContaining('--title') });
    expect(buildEventInput({ title: 'x', start: '2026-11-07T14:00' }, null)).toEqual({ error: expect.stringContaining('--end or --duration') });
    expect(buildEventInput({ title: 'x', allDay: true, start: '2026-11-07T14:00' }, null)).toEqual({ error: expect.stringContaining('--date') });
    expect(buildEventInput({ title: 'x', start: '2026-11-07T14:00', end: '2026-11-07T13:00' }, null)).toEqual({ error: expect.stringContaining('after the start') });
    expect(buildEventInput({ title: 'x', start: '2026-11-07T14:00', duration: '1h', color: 'mauve' }, null)).toEqual({ error: expect.stringContaining('--color') });
    expect(buildEventInput({ title: 'x', start: '2026-11-07T14:00', duration: '1h', until: '2026-12-01' }, null)).toEqual({ error: expect.stringContaining('--repeat') });
  });
});

describe('buildEventInput — update', () => {
  it('moving keeps the length, like dragging', () => {
    expect(buildEventInput({ start: '2026-11-08T09:00:00Z' }, base()))
      .toEqual({ input: { allDay: false, start: '2026-11-08T09:00:00.000Z', end: '2026-11-08T10:30:00.000Z' } });
    expect(buildEventInput({ date: '2026-11-20' }, base({ allDay: true, start: '2026-11-10', end: '2026-11-12' })))
      .toEqual({ input: { allDay: true, start: '2026-11-20', end: '2026-11-22' } });
  });

  it('resizing changes only the end; other fields alone send no dates', () => {
    expect(buildEventInput({ end: '2026-11-07T16:00:00Z' }, base()))
      .toEqual({ input: { allDay: false, start: '2026-11-07T13:00:00.000Z', end: '2026-11-07T16:00:00.000Z' } });
    expect(buildEventInput({ title: 'Renamed', color: 'none', description: 'none' }, base()))
      .toEqual({ input: { title: 'Renamed', color: null, description: null } });
  });

  it('turning a timed event all-day needs its day', () => {
    expect(buildEventInput({ allDay: true }, base())).toEqual({ error: expect.stringContaining('--date') });
    expect(buildEventInput({ allDay: true, date: '2026-11-07' }, base())).toEqual({ input: { allDay: true, start: '2026-11-07', end: '2026-11-07' } });
  });

  it('none clears the repeat, the ticket and the epic', () => {
    expect(buildEventInput({ repeat: 'none' }, base({ recurrence: 'weekly' }), { ticketId: null, epicId: null }))
      .toEqual({ input: { recurrence: null, recurrenceUntil: null, ticketId: null, epicId: null } });
  });
});

describe('resolveEventId', () => {
  it('takes an id, event:<id>, or the ref of an occurrence — never another kind of item', async () => {
    expect(await resolveEventId('3f2a9c10-0000-4000-8000-000000000000')).toEqual({ id: '3f2a9c10-0000-4000-8000-000000000000' });
    expect(await resolveEventId('event:abc')).toEqual({ id: 'abc' });
    expect(await resolveEventId(encodeAgendaItemRef({ id: 'event:abc:2026-11-09T09:00:00.000Z', start: '2026-11-09T09:00:00.000Z' }))).toEqual({ id: 'abc' });
    expect(await resolveEventId(encodeAgendaItemRef({ id: 'external:uid', start: '2026-11-09' }))).toEqual({ error: expect.stringContaining('not a free event') });
  });
});
