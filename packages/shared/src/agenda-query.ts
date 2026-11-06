/**
 * Agenda reads shared by the web sidebar and the headless surface (CLI / MCP):
 * the same filter, search, title-matching and attendee rules on both sides, so
 * "the same options give the same result" holds by construction.
 */
import { AGENDA_ITEM_TYPES, type AgendaItem, type AgendaItemType } from './types/agenda.js';
import { calendarEventLinkKey } from './agenda-events.js';

// ── Text folding ──

/** Lower case, accents and emojis dropped, punctuation → single spaces. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const compact = (title: string) => normalizeTitle(title).replace(/ /g, '');

/**
 * Either normalised title contains the other (empty titles never match). Also
 * compared without spaces, so "Stand-up" (→ "stand up") matches "standup".
 */
export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ca = na.replace(/ /g, '');
  const cb = nb.replace(/ /g, '');
  return ca.includes(cb) || cb.includes(ca);
}

/**
 * The entries whose title matches `wanted`: exact (normalised) matches win over
 * "contains" ones. The caller decides what 0 or several candidates mean.
 */
export function findByTitle<T>(entries: T[], wanted: string, titleOf: (e: T) => string): T[] {
  const w = compact(wanted);
  if (!w) return [];
  const exact = entries.filter((e) => compact(titleOf(e)) === w);
  if (exact.length > 0) return exact;
  return entries.filter((e) => titlesMatch(titleOf(e), wanted));
}

// ── Search and filters ──

/** Search: title, `#123`, ticket title, workflow and routine names (case-insensitive). */
export function matchesAgendaQuery(item: AgendaItem, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^#/, '');
  if (!needle) return true;
  const hay = [
    item.title, item.workflowName, item.routine?.name, item.prRef,
    item.ticket ? `${item.ticket.displayId} ${item.ticket.title}` : null,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

export interface AgendaFilters {
  boards: string[];
  epics: string[];
  repos: string[];
  tags: string[];
}

/**
 * The board / epic / repo / tag filters. An item without the filtered field (a
 * routine run has no board) passes — hiding it would make the filter lie.
 */
export function matchesAgendaFilters(item: AgendaItem, f: AgendaFilters): boolean {
  const { boards, epics, repos, tags } = f;
  const t = item.ticket;
  if (!t) {
    // A free event linked to an epic still answers the Epic filter.
    if (epics.length && item.event?.epicId && !epics.includes(item.event.epicId)) return false;
    return true;
  }
  if (boards.length && !boards.includes(t.boardId)) return false;
  if (epics.length && t.epicIds?.length && !t.epicIds.some((e) => epics.includes(e))) return false;
  if (repos.length && t.repos?.length && !t.repos.some((r) => repos.includes(r))) return false;
  if (tags.length && t.tags.length && !t.tags.some((x) => tags.includes(x))) return false;
  return true;
}

/**
 * A Google meeting with this guest or organizer: name or email, case and
 * accents ignored, either a part of the name ("jean" finds "Jean-Baptiste Durand").
 */
export function matchesAttendee(item: AgendaItem, who: string): boolean {
  if (!normalizeTitle(who)) return true;
  return matchAttendee(item, who) !== null;
}

/**
 * Edit distance between `needle` and the closest substring of `hay` (Sellers):
 * "jonbaptiste" is 2 edits from "jeanbaptiste@…", "baptistes" 1 from "jeanbaptiste".
 */
export function substringDistance(needle: string, hay: string): number {
  const m = needle.length;
  if (m === 0) return 0;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let best = prev[m]!;
  for (let j = 1; j <= hay.length; j++) {
    const cur = [0];
    for (let i = 1; i <= m; i++) {
      const cost = needle[i - 1] === hay[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + cost);
    }
    best = Math.min(best, cur[m]!);
    prev = cur;
  }
  return best;
}

/** Typos tolerated by the approximate attendee match: none under 5 letters, 1 up to 8, then 2. */
export const attendeeTolerance = (len: number) => (len < 5 ? 0 : len <= 8 ? 1 : 2);

/**
 * Who in a Google meeting answers `who`: an exact (case / accents / spaces
 * ignored) match first; with `approximate`, else the closest guest within
 * {@link attendeeTolerance} typos. Returns the guest as written (name or email).
 */
export function matchAttendee(item: AgendaItem, who: string, approximate = false): { attendee: string; approximate: boolean } | null {
  const ext = item.external;
  const wanted = normalizeTitle(who);
  if (!ext || !wanted) return null;
  const all = [
    ...(ext.attendeeList ?? []).map((a) => ({ label: a.name ?? a.email, keys: [a.name, a.email] })),
    ...(ext.organizer ? [{ label: ext.organizer.name ?? ext.organizer.email, keys: [ext.organizer.name, ext.organizer.email] }] : []),
  ];
  const wantedC = wanted.replace(/ /g, '');
  for (const p of all) {
    for (const k of p.keys) {
      if (!k) continue;
      const n = normalizeTitle(k);
      if (n.includes(wanted) || n.replace(/ /g, '').includes(wantedC)) return { attendee: p.label, approximate: false };
    }
  }
  if (!approximate) return null;
  const tol = attendeeTolerance(wantedC.length);
  if (tol === 0) return null;
  let best: { attendee: string; d: number } | null = null;
  for (const p of all) {
    for (const k of p.keys) {
      if (!k) continue;
      // The email's local part only: a domain must not make "exampla" a near miss of example.com.
      const text = k.includes('@') ? k.split('@')[0]! : k;
      const d = substringDistance(wantedC, normalizeTitle(text).replace(/ /g, ''));
      if (d <= tol && (!best || d < best.d)) best = { attendee: p.label, d };
    }
  }
  return best ? { attendee: best.attendee, approximate: true } : null;
}

/** Items a deliverable can be linked to: a Google meeting or a free event (one occurrence). */
export function isLinkableAgendaItem(item: AgendaItem): boolean {
  return (item.type === 'external' && !!item.external) || (item.type === 'event' && !!item.event);
}

/** The deliverable-link key of a Google meeting or of one free-event occurrence; null otherwise. */
export function agendaItemLinkKey(item: AgendaItem): string | null {
  if (item.type === 'external' && item.external) return item.external.eventKey;
  if (item.type === 'event' && item.event) return calendarEventLinkKey(item.event, item.start);
  return null;
}

// ── Item reference ──

/**
 * One opaque, shell-safe handle per agenda item: what `fleex agenda list`
 * prints and every other command accepts. It carries the item id and its start,
 * because a Google meeting id holds no date and the agenda is read by window.
 */
export const AGENDA_REF_PREFIX = 'ag_';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function encodeAgendaItemRef(item: Pick<AgendaItem, 'id' | 'start'>): string {
  return `${AGENDA_REF_PREFIX}${toBase64Url(`${item.start}\n${item.id}`)}`;
}

/** The id and start an item reference carries, or null when it isn't one. */
export function decodeAgendaItemRef(ref: string): { id: string; start: string } | null {
  if (!ref.startsWith(AGENDA_REF_PREFIX)) return null;
  const raw = fromBase64Url(ref.slice(AGENDA_REF_PREFIX.length));
  const nl = raw?.indexOf('\n') ?? -1;
  if (!raw || nl <= 0 || nl === raw.length - 1) return null;
  return { start: raw.slice(0, nl), id: raw.slice(nl + 1) };
}

/** Item types, for validating a `--type` list. */
export function isAgendaItemType(t: string): t is AgendaItemType {
  return (AGENDA_ITEM_TYPES as readonly string[]).includes(t);
}
