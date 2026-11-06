/**
 * Reading the agenda headless: windows, the calendars to read, item references
 * and the long-range search. Shared by every `fleex agenda` command.
 */
import {
  AGENDA_ITEM_TYPES, decodeAgendaItemRef, encodeAgendaItemRef, isAgendaItemType, matchesAgendaFilters,
  matchesAgendaQuery, matchAttendee, type AgendaItem, type AgendaItemType, type AgendaPrefs, type AgendaResponse, type CalendarEvent,
} from '@fleex/shared';
import { apiBase } from '../../core/api.ts';
import { agendaRequest } from './_shared.ts';

const DAY_MS = 24 * 3600_000;
/** The server serves at most six weeks (+ a DST hour) per request — stay under it. */
export const CHUNK_DAYS = 42;
export const MAX_LIST_DAYS = 42;

// ── Local days ──

export const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → local midnight; anything else Date can read → that instant. Null when unreadable. */
export function parseDateArg(s: string): { at: Date; isDay: boolean } | null {
  const v = s.trim();
  if (DAY_RE.test(v)) {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const at = new Date(y, m - 1, d);
    return at.getMonth() === m - 1 ? { at, isDay: true } : null;
  }
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : { at, isDay: false };
}

const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

export const WINDOW_SHORTCUTS = ['today', 'tomorrow', 'yesterday', 'week', 'last-week', 'next-week'] as const;

/**
 * The window of `agenda list`: a shortcut, or `--from` / `--to` (a `--to` day is
 * inclusive). Nothing = today.
 */
export function resolveWindow(opts: { when?: string; from?: string; to?: string }, now = new Date()): { from: Date; to: Date } | { error: string } {
  if (opts.when && (opts.from || opts.to)) return { error: 'Give either a shortcut (today, week…) or --from/--to, not both.' };
  const today = startOfDay(now);
  if (opts.when) {
    switch (opts.when) {
      case 'today': return { from: today, to: addDays(today, 1) };
      case 'tomorrow': return { from: addDays(today, 1), to: addDays(today, 2) };
      case 'yesterday': return { from: addDays(today, -1), to: today };
      case 'week': return { from: mondayOf(now), to: addDays(mondayOf(now), 7) };
      case 'last-week': return { from: addDays(mondayOf(now), -7), to: mondayOf(now) };
      case 'next-week': return { from: addDays(mondayOf(now), 7), to: addDays(mondayOf(now), 14) };
      default: return { error: `Unknown window "${opts.when}" (expected ${WINDOW_SHORTCUTS.join(', ')}).` };
    }
  }
  const from = opts.from ? parseDateArg(opts.from) : { at: today, isDay: true };
  if (!from) return { error: `Invalid --from "${opts.from}" (YYYY-MM-DD or ISO 8601).` };
  let to: Date;
  if (opts.to) {
    const t = parseDateArg(opts.to);
    if (!t) return { error: `Invalid --to "${opts.to}" (YYYY-MM-DD or ISO 8601).` };
    to = t.isDay ? addDays(t.at, 1) : t.at;
  } else {
    to = from.isDay ? addDays(from.at, 1) : new Date(from.at.getTime() + DAY_MS);
  }
  if (to <= from.at) return { error: '--to must be after --from.' };
  if (to.getTime() - from.at.getTime() > MAX_LIST_DAYS * DAY_MS + 3600_000) {
    return { error: `A window is at most ${MAX_LIST_DAYS} days — use \`fleex agenda search\` for a longer period.` };
  }
  return { from: from.at, to };
}

// ── Reading ──

/**
 * The Google calendars to read: `--calendar` when given, else the ones picked in
 * the agenda preferences (like the UI) — [] means the primary one.
 */
export async function calendarsToRead(calendar?: string): Promise<string[]> {
  if (calendar) return calendar.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const { data } = await agendaRequest<AgendaPrefs>('GET', `${apiBase()}/api/agenda/prefs`);
    return Array.isArray(data?.googleCalendars) ? data.googleCalendars : [];
  } catch {
    return [];
  }
}

export async function fetchAgenda(from: Date, to: Date, calendars: string[]): Promise<AgendaResponse> {
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  if (calendars.length) qs.set('calendars', calendars.join(','));
  return (await agendaRequest<AgendaResponse>('GET', `${apiBase()}/api/agenda?${qs}`)).data;
}

/** Every free event (the series, not the occurrences). */
export async function fetchEvents(): Promise<CalendarEvent[]> {
  return (await agendaRequest<CalendarEvent[]>('GET', `${apiBase()}/api/calendar-events`)).data ?? [];
}

// ── Filtering ──

export interface ItemFilterOptions {
  type?: string;
  board?: string[];
  epic?: string[];
  repo?: string[];
  tag?: string[];
  routine?: string[];
  q?: string;
  attendee?: string;
}

/** `--type a,b` → the item types, or an error naming the valid ones. */
export function parseTypes(raw?: string): { types: AgendaItemType[] | null } | { error: string } {
  if (!raw) return { types: null };
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((t) => !isAgendaItemType(t));
  if (bad.length) return { error: `Unknown --type ${bad.join(', ')} (expected ${AGENDA_ITEM_TYPES.join(', ')}).` };
  return { types: list as AgendaItemType[] };
}

export interface ItemFilter {
  types: AgendaItemType[] | null;
  boards: string[];
  epics: string[];
  repos: string[];
  tags: string[];
  /** Routine names or ids. */
  routines: string[];
  q: string | null;
  attendee: string | null;
}

/**
 * How an item answers the filter: 'exact', 'approx' (only the guest name is a
 * near miss — a typo), or null. Same rules as the agenda sidebar and search box
 * (`@fleex/shared`), driven by the options only.
 */
export function itemMatchKind(item: AgendaItem, f: ItemFilter): 'exact' | 'approx' | null {
  if (!itemMatchesExceptAttendee(item, f)) return null;
  if (!f.attendee) return 'exact';
  const m = matchAttendee(item, f.attendee, true);
  return !m ? null : m.approximate ? 'approx' : 'exact';
}

export function itemMatches(item: AgendaItem, f: ItemFilter): boolean {
  return itemMatchKind(item, f) === 'exact';
}

function itemMatchesExceptAttendee(item: AgendaItem, f: ItemFilter): boolean {
  if (f.types && !f.types.includes(item.type)) return false;
  if (f.routines.length) {
    const r = item.routine;
    const want = f.routines.map((x) => x.toLowerCase());
    if (!r || !(want.includes(r.id.toLowerCase()) || want.includes(r.name.toLowerCase()))) return false;
  }
  if (!matchesAgendaFilters(item, { boards: f.boards, epics: f.epics, repos: f.repos, tags: f.tags })) return false;
  if (f.q && !matchesAgendaQuery(item, f.q)) return false;
  return true;
}

// ── Item references ──

export interface ResolvedItem {
  item: AgendaItem;
  ref: string;
}

export const refOf = (item: AgendaItem) => encodeAgendaItemRef(item);

/**
 * The agenda item a reference points at: an `ag_…` ref from `agenda list` /
 * `search`, or `event:<id>` for a free event. Read again from the agenda, so the
 * fiche is always current.
 */
export async function resolveItem(ref: string, calendars: string[]): Promise<ResolvedItem | { error: string }> {
  const r = ref.trim();
  const decoded = decodeAgendaItemRef(r);
  if (decoded) {
    const at = parseDateArg(decoded.start);
    if (!at) return { error: `Agenda reference ${r} carries an unreadable date.` };
    const day = startOfDay(at.at);
    const res = await fetchAgenda(addDays(day, -1), addDays(day, 2), calendars);
    const item = res.items.find((i) => i.id === decoded.id);
    if (!item) return { error: `Agenda item not found (it may have been deleted or moved): ${decoded.id}` };
    return { item, ref: refOf(item) };
  }
  const ev = /^event:([^:]+)$/.exec(r) ?? (/^[0-9a-f-]{36}$/i.test(r) ? [r, r] : null);
  if (ev) {
    const id = ev[1]!;
    const e = (await fetchEvents()).find((x) => x.id === id);
    if (!e) return { error: `No free event ${id}.` };
    if (e.recurrence) return { error: `Event ${id} repeats — pick one occurrence with its ref from \`fleex agenda list\`.` };
    const at = parseDateArg(e.start)!;
    const day = startOfDay(at.at);
    const res = await fetchAgenda(addDays(day, -1), addDays(day, 2), calendars);
    const item = res.items.find((i) => i.type === 'event' && i.event?.id === id);
    if (!item) return { error: `Event ${id} not found in the agenda.` };
    return { item, ref: refOf(item) };
  }
  return { error: `Not an agenda item reference: "${r}". Use the ref printed by \`fleex agenda list\` / \`search\` (ag_…), or event:<id> for a free event.` };
}

// ── Output ──

const time = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "2026-11-07 14:00–15:00", "2026-11-07 all day", "2026-11-07 09:12". */
export function whenOf(item: AgendaItem): string {
  if (item.shape === 'allDay') return item.end && item.end > item.start ? `${item.start} → ${item.end} all day` : `${item.start} all day`;
  const s = new Date(item.start);
  if (item.shape === 'point') return `${dayKey(s)} ${time(item.start)}`;
  if (!item.end) return `${dayKey(s)} ${time(item.start)}–now`;
  const e = new Date(item.end);
  return dayKey(e) === dayKey(s) ? `${dayKey(s)} ${time(item.start)}–${time(item.end)}` : `${dayKey(s)} ${time(item.start)} → ${dayKey(e)} ${time(item.end)}`;
}

/** The compact shape an agent reads: what, when, who, and the ref to act on it. */
export function summarize(item: AgendaItem, attendee?: string | null) {
  const m = attendee ? matchAttendee(item, attendee, true) : null;
  const ext = item.external;
  return {
    ref: refOf(item),
    id: item.id,
    type: item.type,
    title: item.title,
    start: item.start,
    end: item.end ?? null,
    when: whenOf(item),
    status: item.status ?? null,
    ticket: item.ticket ? { id: item.ticket.id, displayId: item.ticket.displayId, title: item.ticket.title } : null,
    routine: item.routine ? { id: item.routine.id, name: item.routine.name } : null,
    eventId: item.event?.id ?? null,
    attendees: ext?.attendeeList?.map((a) => a.name ?? a.email) ?? undefined,
    rsvp: ext?.rsvp ?? undefined,
    meetUrl: ext?.meetUrl ?? undefined,
    links: (ext?.links ?? item.eventLinks ?? []).length || undefined,
    // Set when --attendee only matched a near spelling: confirm with the user.
    match: m?.approximate ? { approximate: true, attendee: m.attendee } : undefined,
  };
}

export function itemLine(item: AgendaItem): string {
  const who = item.ticket ? `#${item.ticket.displayId} ` : '';
  const links = (item.external?.links ?? item.eventLinks ?? []).length;
  return `${whenOf(item).padEnd(28)} ${item.type.padEnd(16)} ${who}${item.title}${links ? `  [${links} deliverable${links > 1 ? 's' : ''}]` : ''}\n    ${refOf(item)}`;
}

/**
 * Exact matches when there are any; else the near misses on the guest name
 * (typos), flagged so the caller says they are approximate.
 */
export function pickMatches(items: AgendaItem[], f: ItemFilter): { items: AgendaItem[]; approximate: boolean } {
  const kinds = items.map((i) => [i, itemMatchKind(i, f)] as const);
  const exact = kinds.filter(([, k]) => k === 'exact').map(([i]) => i);
  if (exact.length || !f.attendee) return { items: exact, approximate: false };
  const near = kinds.filter(([, k]) => k === 'approx').map(([i]) => i);
  return { items: near, approximate: near.length > 0 };
}

/** What to tell the user (or the assistant) when --attendee found nobody. */
export const attendeeHint = (who: string) =>
  `No guest matches "${who}" — try a part of the name (one word), the email, or list the period without --attendee.`;

// ── Long-range search ──

export interface SearchRange {
  since: Date;
  until: Date;
}

/** Default reach of `agenda search`: one year back, three months ahead. */
export function defaultSearchRange(now = new Date()): SearchRange {
  const today = startOfDay(now);
  return { since: addDays(today, -365), until: addDays(today, 92) };
}

/**
 * Windows of ≤ CHUNK_DAYS moving away from `anchor` on both sides, ring by ring
 * (ahead, then behind), clipped to [since, until).
 */
export function searchChunks(range: SearchRange, anchor: Date): { from: Date; to: Date }[][] {
  const a = new Date(Math.min(Math.max(anchor.getTime(), range.since.getTime()), range.until.getTime()));
  const rings: { from: Date; to: Date }[][] = [];
  for (let k = 0; ; k++) {
    const ring: { from: Date; to: Date }[] = [];
    const fFrom = addDays(a, k * CHUNK_DAYS);
    if (fFrom < range.until) ring.push({ from: fFrom, to: new Date(Math.min(addDays(a, (k + 1) * CHUNK_DAYS).getTime(), range.until.getTime())) });
    const bTo = addDays(a, -k * CHUNK_DAYS);
    if (bTo > range.since) ring.push({ from: new Date(Math.max(addDays(a, -(k + 1) * CHUNK_DAYS).getTime(), range.since.getTime())), to: bTo });
    if (!ring.length) break;
    rings.push(ring);
  }
  return rings;
}

/**
 * Search the agenda ring by ring around today, nearest first, until `limit`
 * matches are in hand or the range is covered. Returns what it covered, so the
 * caller can say how far it looked.
 */
export async function searchAgenda(
  match: (item: AgendaItem) => 'exact' | 'approx' | null | boolean,
  range: SearchRange,
  limit: number,
  calendars: string[],
  now = new Date(),
  fetchFn: typeof fetchAgenda = fetchAgenda,
): Promise<{ items: AgendaItem[]; covered: SearchRange; errors: string[]; approximate: boolean }> {
  const anchor = now;
  const found = new Map<string, AgendaItem>();
  const near = new Map<string, AgendaItem>();
  let lo = new Date(Math.min(Math.max(anchor.getTime(), range.since.getTime()), range.until.getTime()));
  let hi = lo;
  const errors = new Set<string>();
  for (const ring of searchChunks(range, anchor)) {
    const results = await Promise.all(ring.map((w) => fetchFn(w.from, w.to, calendars)));
    for (const [i, res] of results.entries()) {
      for (const e of Object.values(res.errors ?? {})) if (e) errors.add(e);
      for (const it of res.items) {
        const k = match(it);
        if (k === true || k === 'exact') found.set(it.id, it);
        else if (k === 'approx') near.set(it.id, it);
      }
      const w = ring[i]!;
      if (w.from < lo) lo = w.from;
      if (w.to > hi) hi = w.to;
    }
    if (found.size >= limit) break;
  }
  const dist = (it: AgendaItem) => Math.abs(new Date(it.start.length === 10 ? `${it.start}T12:00:00` : it.start).getTime() - anchor.getTime());
  // Near misses (a typo in the guest name) only when nothing matched exactly.
  const approximate = found.size === 0 && near.size > 0;
  const pool = approximate ? near : found;
  const items = [...pool.values()].sort((x, y) => dist(x) - dist(y)).slice(0, limit);
  return { items, covered: { since: lo, until: hi }, errors: [...errors], approximate };
}

// ── Shared option set (list / search) ──

const collect = (v: string, prev: string[] = []) => [...prev, ...v.split(',').map((s) => s.trim()).filter(Boolean)];

/** The filter options `list` and `search` share. */
export function addFilterOptions(cmd: import('commander').Command): void {
  cmd.option('--type <types>', `Only these item types, comma-separated (${AGENDA_ITEM_TYPES.join(', ')})`);
  cmd.option('--board <board>', 'Only tickets of this board (name, UUID or 8-char prefix; repeatable)', collect);
  cmd.option('--epic <epic>', 'Only tickets / events of this epic (name, UUID or prefix; repeatable)', collect);
  cmd.option('--repo <org/name>', 'Only tickets linked to this repository (repeatable)', collect);
  cmd.option('--tag <tag>', 'Only tickets with this tag (repeatable)', collect);
  cmd.option('--routine <routine>', 'Only this routine (name or id; repeatable)', collect);
  cmd.option('--q <text>', 'Text search: title, #ticket, ticket title, workflow, routine');
  cmd.option('--attendee <who>', 'Google meetings with this guest or organizer (name or email, partial, case and accents ignored). Nothing exact? Near spellings (typos) come back flagged approximate');
  cmd.option('--calendar <ids>', 'Google calendar ids to read, comma-separated (default: the calendars picked in the agenda preferences)');
}

/** Options → filter, resolving board and epic references. */
export async function buildFilter(opts: ItemFilterOptions): Promise<ItemFilter | { error: string }> {
  const t = parseTypes(opts.type);
  if ('error' in t) return t;
  const { resolveBoardId } = await import('../board/_shared.ts');
  const { resolveEpicId } = await import('../epic/_shared.ts');
  const boards = await Promise.all((opts.board ?? []).map((b) => resolveBoardId(b)));
  const epics = await Promise.all((opts.epic ?? []).map((e) => resolveEpicId(e)));
  return {
    types: t.types, boards, epics, repos: opts.repo ?? [], tags: opts.tag ?? [], routines: opts.routine ?? [],
    q: opts.q?.trim() || null, attendee: opts.attendee?.trim() || null,
  };
}
