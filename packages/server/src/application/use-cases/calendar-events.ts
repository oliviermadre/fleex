import { randomUUID } from 'node:crypto';
import type { CalendarEvent, CalendarEventInput, CalendarEventRecurrence } from '@fleex/shared';
import type { KvStorePort } from '../ports/kv-store.port.js';

/**
 * E1 — free events created in the agenda. Stored in the KV store, one key per
 * event (`agenda:event:<id>`, JSON {@link CalendarEvent}): no table, shared by
 * every user of the instance.
 */
export const CALENDAR_EVENT_PREFIX = 'agenda:event:';
const TITLE_MAX = 120;
const COLOR_MAX = 20;
const DESCRIPTION_MAX = 10_000;
const RECURRENCES = new Set<CalendarEventRecurrence>(['daily', 'weekly', 'monthly']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const eventKey = (id: string) => `${CALENDAR_EVENT_PREFIX}${id}`;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isDayKey(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

function isInstant(v: unknown): v is string {
  return typeof v === 'string' && v.includes('T') && !Number.isNaN(Date.parse(v));
}

type Normalized = Required<CalendarEventInput>;

/**
 * Validates a create body (`base` absent) or a PATCH body merged over the
 * stored event (`base` set). Returns the full, normalised input — instants are
 * rewritten as `toISOString()` so string comparison sorts them.
 */
export function parseCalendarEventInput(body: unknown, base?: Normalized): { input: Normalized } | { error: string } {
  if (!isObject(body)) return { error: 'the event must be an object' };
  const pick = <K extends keyof Normalized>(k: K): unknown => (k in body ? body[k] : base?.[k]);

  const title = pick('title');
  if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > TITLE_MAX) {
    return { error: `title must be 1 to ${TITLE_MAX} characters` };
  }
  const allDay = pick('allDay');
  if (typeof allDay !== 'boolean') return { error: 'allDay must be a boolean' };
  let start = pick('start');
  let end = pick('end');
  if (allDay) {
    if (!isDayKey(start) || !isDayKey(end)) return { error: 'an all-day event has start and end as YYYY-MM-DD' };
    if (end < start) return { error: 'end must not be before start' };
  } else {
    if (!isInstant(start) || !isInstant(end)) return { error: 'start and end must be ISO instants' };
    start = new Date(start).toISOString();
    end = new Date(end).toISOString();
    if ((end as string) <= (start as string)) return { error: 'end must be after start' };
  }
  const description = pick('description') ?? null;
  if (description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
    return { error: `description must be a string of at most ${DESCRIPTION_MAX} characters, or null` };
  }
  const color = pick('color') ?? null;
  if (color !== null && (typeof color !== 'string' || color.length > COLOR_MAX)) {
    return { error: `color must be a string of at most ${COLOR_MAX} characters, or null` };
  }
  const ticketId = pick('ticketId') ?? null;
  if (ticketId !== null && typeof ticketId !== 'string') return { error: 'ticketId must be a string or null' };
  const epicId = pick('epicId') ?? null;
  if (epicId !== null && typeof epicId !== 'string') return { error: 'epicId must be a string or null' };
  const recurrence = pick('recurrence') ?? null;
  if (recurrence !== null && !RECURRENCES.has(recurrence as CalendarEventRecurrence)) {
    return { error: 'recurrence must be daily, weekly, monthly or null' };
  }
  const recurrenceUntil = pick('recurrenceUntil') ?? null;
  if (recurrenceUntil !== null && !isDayKey(recurrenceUntil)) return { error: 'recurrenceUntil must be YYYY-MM-DD or null' };

  return {
    input: {
      title: title.trim(),
      allDay,
      start: start as string,
      end: end as string,
      description: description as string | null,
      color: color as string | null,
      ticketId: ticketId as string | null,
      epicId: epicId as string | null,
      recurrence: recurrence as CalendarEventRecurrence | null,
      recurrenceUntil: recurrenceUntil as string | null,
    },
  };
}

function inputOf(e: CalendarEvent): Normalized {
  return {
    title: e.title, allDay: e.allDay, start: e.start, end: e.end, description: e.description, color: e.color,
    ticketId: e.ticketId, epicId: e.epicId, recurrence: e.recurrence, recurrenceUntil: e.recurrenceUntil,
  };
}

export class CalendarEventNotFoundError extends Error {
  constructor(id: string) {
    super(`Calendar event ${id} not found`);
  }
}

export class CalendarEventValidationError extends Error {}

/** CRUD over the KV store. */
export class CalendarEventsService {
  constructor(
    private readonly kv: KvStorePort,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async list(): Promise<CalendarEvent[]> {
    return listCalendarEvents(this.kv);
  }

  async get(id: string): Promise<CalendarEvent | null> {
    const raw = await this.kv.get(eventKey(id));
    return raw ? readEvent(raw) : null;
  }

  async create(body: unknown): Promise<CalendarEvent> {
    const parsed = parseCalendarEventInput(body);
    if ('error' in parsed) throw new CalendarEventValidationError(parsed.error);
    const at = this.now().toISOString();
    const event: CalendarEvent = { id: this.newId(), ...parsed.input, createdAt: at, updatedAt: at };
    await this.kv.set(eventKey(event.id), JSON.stringify(event));
    return event;
  }

  async update(id: string, body: unknown): Promise<CalendarEvent> {
    const current = await this.get(id);
    if (!current) throw new CalendarEventNotFoundError(id);
    const parsed = parseCalendarEventInput(body, inputOf(current));
    if ('error' in parsed) throw new CalendarEventValidationError(parsed.error);
    const event: CalendarEvent = { ...current, ...parsed.input, updatedAt: this.now().toISOString() };
    await this.kv.set(eventKey(id), JSON.stringify(event));
    return event;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.get(id))) throw new CalendarEventNotFoundError(id);
    await this.kv.delete(eventKey(id));
  }
}

function readEvent(raw: string): CalendarEvent | null {
  try {
    const v = JSON.parse(raw) as CalendarEvent;
    return isObject(v) && typeof v.id === 'string' && typeof v.start === 'string' && typeof v.end === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Every stored event; corrupted rows are skipped. */
export async function listCalendarEvents(kv: KvStorePort): Promise<CalendarEvent[]> {
  const rows = await kv.listByPrefix(CALENDAR_EVENT_PREFIX);
  return rows.map((r) => readEvent(r.value)).filter((e): e is CalendarEvent => e !== null);
}

// ── Recurrence expansion: pure, shared with the web (see @fleex/shared) ──

export { expandCalendarEvent, EVENT_OCCURRENCE_CAP, type EventOccurrence } from '@fleex/shared';
