import type { CalendarEvent, CalendarEventInput } from '@fleex/shared';
import { TINT_HUES_FOR_EVENTS } from './_colors.ts';
import { addDays, dayKey, pad, parseDateArg } from '../_read.ts';

export interface EventOptions {
  title?: string;
  allDay?: boolean;
  timed?: boolean;
  date?: string;
  lastDay?: string;
  start?: string;
  end?: string;
  duration?: string;
  description?: string;
  color?: string;
  ticket?: string;
  epic?: string;
  repeat?: string;
  until?: string;
}

const NONE = new Set(['none', 'null', '']);
const REPEATS = new Set(['daily', 'weekly', 'monthly']);

/** "45m", "1h", "1h30", "90" (minutes) → minutes. */
export function parseDuration(s: string): number | null {
  const v = s.trim().toLowerCase();
  let m = /^(\d+)$/.exec(v);
  if (m) return Number(m[1]);
  m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:m|min)?)?$/.exec(v);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * The fields of an event the options set, on top of `base` (update) or from
 * scratch (create). Moving keeps the length: a new start without an end shifts
 * the end too, as dragging does in the UI.
 */
export function buildEventInput(
  opts: EventOptions,
  base: CalendarEvent | null,
  refs: { ticketId?: string | null; epicId?: string | null } = {},
): { input: Partial<CalendarEventInput> } | { error: string } {
  const out: Partial<CalendarEventInput> = {};
  if (opts.allDay && opts.timed) return { error: 'Use either --all-day or --timed, not both.' };
  if (opts.title !== undefined) {
    if (!opts.title.trim()) return { error: '--title cannot be empty.' };
    out.title = opts.title.trim();
  }
  const allDay = opts.allDay ? true : opts.timed ? false : base ? base.allDay : !!(opts.date && !opts.start);
  const kindChanged = !!base && allDay !== base.allDay;

  if (allDay) {
    if (opts.start || opts.end || opts.duration) return { error: 'An all-day event takes --date [--last-day], not --start/--end/--duration.' };
    if (opts.date !== undefined || opts.lastDay !== undefined || kindChanged || !base) {
      const first = opts.date ?? (base && !kindChanged ? base.start : undefined);
      if (!first) return { error: 'An all-day event needs --date YYYY-MM-DD.' };
      if (!isDay(first) || !parseDateArg(first)) return { error: `Invalid --date "${first}" (YYYY-MM-DD).` };
      let last = opts.lastDay;
      if (last === undefined) {
        if (base && base.allDay && opts.date) {
          const span = Math.round((parseDateArg(base.end)!.at.getTime() - parseDateArg(base.start)!.at.getTime()) / 86_400_000);
          last = dayKey(addDays(parseDateArg(first)!.at, span));
        } else last = base && base.allDay && !opts.date ? base.end : first;
      }
      if (!isDay(last) || !parseDateArg(last)) return { error: `Invalid --last-day "${last}" (YYYY-MM-DD).` };
      if (last < first) return { error: '--last-day must not be before --date.' };
      Object.assign(out, { allDay: true, start: first, end: last });
    }
  } else {
    if (opts.date || opts.lastDay) return { error: 'A timed event takes --start and --end (or --duration), not --date/--last-day. Add --all-day for an all-day event.' };
    if (opts.end && opts.duration) return { error: 'Use either --end or --duration, not both.' };
    if (opts.start !== undefined || opts.end !== undefined || opts.duration !== undefined || kindChanged || !base) {
      const startArg = opts.start ?? (base && !kindChanged ? base.start : undefined);
      if (!startArg) return { error: 'A timed event needs --start (ISO 8601, e.g. 2026-11-07T14:00) and --end or --duration.' };
      const s = parseDateArg(startArg);
      if (!s || s.isDay) return { error: `Invalid --start "${startArg}" (a date and time, e.g. 2026-11-07T14:00).` };
      let end: Date;
      if (opts.duration) {
        const m = parseDuration(opts.duration);
        if (!m) return { error: `Invalid --duration "${opts.duration}" (e.g. 30m, 1h, 1h30).` };
        end = new Date(s.at.getTime() + m * 60_000);
      } else if (opts.end) {
        const e = parseDateArg(opts.end);
        if (!e || e.isDay) return { error: `Invalid --end "${opts.end}" (a date and time).` };
        end = e.at;
      } else if (base && !base.allDay && !kindChanged) {
        end = new Date(s.at.getTime() + (new Date(base.end).getTime() - new Date(base.start).getTime()));
      } else return { error: 'A timed event needs --end or --duration.' };
      if (end <= s.at) return { error: 'The end must be after the start.' };
      Object.assign(out, { allDay: false, start: s.at.toISOString(), end: end.toISOString() });
    }
  }

  if (opts.description !== undefined) out.description = NONE.has(opts.description.trim()) ? null : opts.description;
  if (opts.color !== undefined) {
    const col = opts.color.trim().toLowerCase();
    if (NONE.has(col) || col === 'default') out.color = null;
    else if (TINT_HUES_FOR_EVENTS.includes(col)) out.color = col;
    else return { error: `Invalid --color "${opts.color}" (expected ${TINT_HUES_FOR_EVENTS.join(', ')}, or none to follow the Events label).` };
  }
  if (refs.ticketId !== undefined) out.ticketId = refs.ticketId;
  if (refs.epicId !== undefined) out.epicId = refs.epicId;
  if (opts.repeat !== undefined) {
    const r = opts.repeat.trim().toLowerCase();
    if (NONE.has(r)) { out.recurrence = null; out.recurrenceUntil = null; }
    else if (REPEATS.has(r)) out.recurrence = r as CalendarEventInput['recurrence'] & string;
    else return { error: `Invalid --repeat "${opts.repeat}" (daily, weekly, monthly or none).` };
  }
  if (opts.until !== undefined) {
    const u = opts.until.trim();
    if (NONE.has(u)) out.recurrenceUntil = null;
    else if (isDay(u) && parseDateArg(u)) out.recurrenceUntil = u;
    else return { error: `Invalid --until "${opts.until}" (YYYY-MM-DD or none).` };
    if (out.recurrenceUntil && !(out.recurrence ?? base?.recurrence)) return { error: '--until needs a repeating event (--repeat daily|weekly|monthly).' };
  }
  if (!base && !out.title) return { error: 'An event needs --title.' };
  return { input: out };
}

/** Options shared by `event create` and `event update`. */
export function addEventOptions(cmd: import('commander').Command, update: boolean): void {
  cmd.option('--title <text>', update ? 'New title' : 'Title (required)');
  cmd.option('--all-day', update ? 'Make it an all-day event (with --date)' : 'All-day event (with --date [--last-day])');
  if (update) cmd.option('--timed', 'Make it a timed event (with --start and --end/--duration)');
  cmd.option('--date <YYYY-MM-DD>', 'All-day: first day');
  cmd.option('--last-day <YYYY-MM-DD>', 'All-day: last day, inclusive (default: --date, or the same length when moving)');
  cmd.option('--start <datetime>', 'Timed: start, ISO 8601 (2026-11-07T14:00 = local time)');
  cmd.option('--end <datetime>', 'Timed: end, ISO 8601');
  cmd.option('--duration <len>', 'Timed: length instead of --end (30m, 1h, 1h30)');
  cmd.option('--description <text>', update ? 'Notes (none clears them)' : 'Notes');
  cmd.option('--color <hue>', `Own colour: ${TINT_HUES_FOR_EVENTS.join(', ')}; none = follow the Events label (default)`);
  cmd.option('--ticket <ref>', update ? 'Linked ticket (display id or UUID; none unlinks)' : 'Linked ticket (display id or UUID)');
  cmd.option('--epic <ref>', update ? 'Linked epic (name, UUID or prefix; none unlinks)' : 'Linked epic (name, UUID or prefix)');
  cmd.option('--repeat <rule>', 'daily | weekly | monthly' + (update ? ' | none' : ''));
  cmd.option('--until <YYYY-MM-DD>', 'Last day of the series, inclusive' + (update ? ' (none = forever)' : ''));
}

/** Ticket / epic references → ids (`none` → null; absent → undefined). */
export async function resolveRefs(opts: EventOptions): Promise<{ ticketId?: string | null; epicId?: string | null }> {
  const out: { ticketId?: string | null; epicId?: string | null } = {};
  if (opts.ticket !== undefined) {
    if (NONE.has(opts.ticket.trim())) out.ticketId = null;
    else {
      const { resolveAnyTicketUuid } = await import('../../ticket/_shared.ts');
      out.ticketId = await resolveAnyTicketUuid(opts.ticket);
    }
  }
  if (opts.epic !== undefined) {
    if (NONE.has(opts.epic.trim())) out.epicId = null;
    else {
      const { resolveEpicId } = await import('../../epic/_shared.ts');
      out.epicId = await resolveEpicId(opts.epic);
    }
  }
  return out;
}

export function eventLine(e: CalendarEvent): string {
  const t = (iso: string) => { const d = new Date(iso); return `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const when = e.allDay ? (e.end > e.start ? `${e.start} → ${e.end} all day` : `${e.start} all day`) : `${t(e.start)} → ${t(e.end)}`;
  return `${e.id}  ${when}  ${e.title}${e.recurrence ? `  (repeats ${e.recurrence}${e.recurrenceUntil ? ` until ${e.recurrenceUntil}` : ''})` : ''}`;
}

/** A free event's id from its id, `event:<id>`, or an agenda ref of one of its occurrences. */
export async function resolveEventId(ref: string): Promise<{ id: string } | { error: string }> {
  const r = ref.trim();
  const { decodeAgendaItemRef } = await import('@fleex/shared');
  const decoded = decodeAgendaItemRef(r);
  const raw = decoded ? decoded.id : r;
  const m = /^event:([^:]+)/.exec(raw);
  if (m) return { id: m[1]! };
  if (decoded) return { error: 'This agenda item is not a free event (only events created in Fleex can be edited).' };
  if (/^[0-9a-f-]{8,}$/i.test(raw)) return { id: raw };
  return { error: `Not a free event: "${r}" (use its id, event:<id>, or its ag_… ref from \`fleex agenda list\`).` };
}
