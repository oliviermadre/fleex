/**
 * E1 free events — pure helpers shared by the server (GET /api/agenda) and the
 * web (the agenda shows a created / edited event at once, before the refetch).
 */
import type { CalendarEvent } from './types/agenda.js';

/** Occurrences of one recurring series per request. */
export const EVENT_OCCURRENCE_CAP = 500;

const DAY_MS = 24 * 3600_000;

/** The agenda item id of one occurrence (a non-recurring event has a single item). */
export function calendarEventItemId(event: Pick<CalendarEvent, 'id' | 'recurrence'>, occurrenceStart: string): string {
  return event.recurrence ? `event:${event.id}:${occurrenceStart}` : `event:${event.id}`;
}

/** Prefix of every deliverable-link key of a free event. */
export const CALENDAR_EVENT_LINK_PREFIX = 'fleex-event:';

/**
 * The key a deliverable is attached to: the event, plus the occurrence start
 * for a recurring one — notes belong to "the 12 Nov planning", not the series
 * (same rule as a recurring Google meeting).
 */
export function calendarEventLinkKey(event: Pick<CalendarEvent, 'id' | 'recurrence'>, occurrenceStart: string): string {
  const base = `${CALENDAR_EVENT_LINK_PREFIX}${event.id}`;
  return event.recurrence ? `${base}|${occurrenceStart}` : base;
}

// ── Recurrence expansion ──

export interface EventOccurrence {
  /** Same format as the event: ISO instant, or 'YYYY-MM-DD' when all-day. */
  start: string;
  /** ISO instant (exclusive), or the inclusive last day when all-day. */
  end: string;
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The occurrences of `event` overlapping `[from, to)`, at most `cap`.
 *
 * Recurrence is date arithmetic on the UTC fields (a 09:00Z weekly stays at
 * 09:00Z across a DST change). Monthly keeps the day of month and skips the
 * months that lack it (the 31st has no February occurrence). An all-day day is
 * in the window when its noon UTC is within 12 h of it — the rule the due
 * dates use, robust to the client's local-midnight bounds.
 */
export function expandCalendarEvent(event: CalendarEvent, from: Date, to: Date, cap: number = EVENT_OCCURRENCE_CAP): EventOccurrence[] {
  if (cap <= 0) return [];
  const allDay = event.allDay;
  const s0 = allDay ? dayMs(event.start) : Date.parse(event.start);
  const e0 = allDay ? dayMs(event.end) : Date.parse(event.end);
  if (Number.isNaN(s0) || Number.isNaN(e0)) return [];
  const duration = e0 - s0;
  // All-day: noon of the first day < `to + 12h` ⇔ start < to, and noon of the
  // last day ≥ `from - 12h` ⇔ last day's midnight ≥ from - 24h.
  const lo = allDay ? from.getTime() - DAY_MS : from.getTime();
  const hi = to.getTime();
  const overlaps = (s: number) => (allDay ? s < hi && s + duration >= lo : s < hi && s + duration > lo);
  const fmt = (s: number): EventOccurrence => (allDay
    ? { start: toDay(s), end: toDay(s + duration) }
    : { start: new Date(s).toISOString(), end: new Date(s + duration).toISOString() });

  if (!event.recurrence) return overlaps(s0) ? [fmt(s0)] : [];

  const until = event.recurrenceUntil ? dayMs(event.recurrenceUntil) + DAY_MS : Infinity; // exclusive
  const base = new Date(s0);
  const at = (k: number): number | null => {
    if (event.recurrence === 'monthly') {
      const t = Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + k, base.getUTCDate(),
        base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds());
      return new Date(t).getUTCDate() === base.getUTCDate() ? t : null;
    }
    const days = event.recurrence === 'weekly' ? 7 : 1;
    return s0 + k * days * DAY_MS;
  };
  // Jump close to the window rather than walking a years-old series from its
  // first occurrence. An occurrence k starts at most k × period after s0.
  const period = event.recurrence === 'monthly' ? 31 * DAY_MS : event.recurrence === 'weekly' ? 7 * DAY_MS : DAY_MS;
  const k0 = Math.max(0, Math.floor((lo - duration - s0) / period) - 1);

  const out: EventOccurrence[] = [];
  for (let k = k0, guard = 0; guard < cap * 4 + 64; k++, guard++) {
    const s = at(k);
    if (s === null) continue;
    if (s >= hi || s >= until) break;
    if (overlaps(s)) {
      out.push(fmt(s));
      if (out.length >= cap) break;
    }
  }
  return out;
}
