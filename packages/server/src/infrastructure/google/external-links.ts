/**
 * Deliverable ↔ Google meeting links (E3). Stored in the KV store, one entry
 * per link (`agenda:link:<id>`): the link only lives in Fleex, Google is never
 * written to.
 */
import { randomUUID } from 'node:crypto';
import type { AgendaExternalLink } from '@fleex/shared';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import type { GoogleCalendarEvent } from './google-calendar.client.js';

export const LINK_KEY_PREFIX = 'agenda:link:';

export interface ExternalLinkInput {
  eventKey: string;
  deliverableId: string;
  deliverableTitle: string;
  eventTitle: string;
  eventStart: string;
  source: AgendaExternalLink['source'];
}

/**
 * The stable key of a meeting: its iCalUID (shared by every calendar that sees
 * it), plus the original start of the occurrence for one instance of a
 * recurring series — so a link sticks to "the 5 Nov stand-up", not the series.
 * The original start is normalised to a UTC ISO instant so the key doesn't
 * depend on the time zone Google answers in.
 */
export function eventKeyOf(event: GoogleCalendarEvent): string {
  const uid = event.iCalUID || event.id;
  if (!event.recurringEventId && !event.originalStartTime) return uid;
  const original = event.originalStartTime;
  let at = original?.dateTime ?? original?.date ?? null;
  if (original?.dateTime) {
    const d = new Date(original.dateTime);
    if (!Number.isNaN(d.getTime())) at = d.toISOString();
  }
  return at ? `${uid}|${at}` : uid;
}

/** The start of a Google event as the agenda stores it: an ISO instant or 'YYYY-MM-DD'. */
export function eventStartOf(event: GoogleCalendarEvent): string {
  if (event.start?.dateTime) {
    const d = new Date(event.start.dateTime);
    return Number.isNaN(d.getTime()) ? event.start.dateTime : d.toISOString();
  }
  return event.start?.date ?? '';
}

/** Lowercase, no accents, no emojis or punctuation, single spaces. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

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

const compact = (title: string) => normalizeTitle(title).replace(/ /g, '');

/** `(Wisprflow id = <x>)` in a deliverable title — two deliverables of one Wisprflow meeting share it. */
export function wisprflowIdOf(title: string): string | null {
  const m = title.match(/\(\s*wisprflow\s+id\s*=\s*([^)\s]+)\s*\)/i);
  return m ? m[1]! : null;
}

/**
 * The meetings of a list whose title matches `matchTitle`: exact (normalised)
 * matches win over "contains" ones; cancelled events are ignored and the same
 * meeting seen from two calendars counts once. The caller decides what 0 or
 * several candidates mean.
 */
export function findMeeting(events: GoogleCalendarEvent[], matchTitle: string): GoogleCalendarEvent[] {
  const wanted = compact(matchTitle);
  if (!wanted) return [];
  const seen = new Set<string>();
  const live = events.filter((e) => {
    if (e.status === 'cancelled') return false;
    const key = eventKeyOf(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const exact = live.filter((e) => compact(e.summary ?? '') === wanted);
  if (exact.length > 0) return exact;
  return live.filter((e) => titlesMatch(e.summary ?? '', matchTitle));
}

export class ExternalLinksStore {
  constructor(
    private readonly kv: KvStorePort,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Every link, oldest first, optionally narrowed to one deliverable and/or one meeting. */
  async list(filter: { deliverableId?: string; eventKey?: string } = {}): Promise<AgendaExternalLink[]> {
    const rows = await this.kv.listByPrefix(LINK_KEY_PREFIX);
    const links: AgendaExternalLink[] = [];
    for (const row of rows) {
      try {
        const link = JSON.parse(row.value) as AgendaExternalLink;
        if (typeof link.id !== 'string' || typeof link.eventKey !== 'string') continue;
        if (filter.deliverableId && link.deliverableId !== filter.deliverableId) continue;
        if (filter.eventKey && link.eventKey !== filter.eventKey) continue;
        links.push(link);
      } catch {
        // A corrupt entry must not hide the others.
      }
    }
    return links.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Links grouped by event key — what the agenda source attaches to each meeting. */
  async byEventKey(): Promise<Map<string, AgendaExternalLink[]>> {
    const out = new Map<string, AgendaExternalLink[]>();
    for (const link of await this.list()) {
      const list = out.get(link.eventKey) ?? [];
      list.push(link);
      out.set(link.eventKey, list);
    }
    return out;
  }

  async get(id: string): Promise<AgendaExternalLink | null> {
    const raw = await this.kv.get(LINK_KEY_PREFIX + id);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AgendaExternalLink;
    } catch {
      return null;
    }
  }

  /**
   * Idempotent on (eventKey, deliverableId). Also returns the existing link
   * when the meeting already carries a deliverable of the same Wisprflow
   * meeting (`(Wisprflow id = x)` in both titles): one transcript, one chip.
   */
  async create(input: ExternalLinkInput): Promise<{ link: AgendaExternalLink; created: boolean }> {
    const onEvent = await this.list({ eventKey: input.eventKey });
    const same = onEvent.find((l) => l.deliverableId === input.deliverableId);
    if (same) return { link: same, created: false };
    const wid = wisprflowIdOf(input.deliverableTitle);
    if (wid) {
      const twin = onEvent.find((l) => wisprflowIdOf(l.deliverableTitle) === wid);
      if (twin) return { link: twin, created: false };
    }
    const link: AgendaExternalLink = {
      id: this.newId(),
      provider: 'google',
      eventKey: input.eventKey,
      deliverableId: input.deliverableId,
      deliverableTitle: input.deliverableTitle,
      eventTitle: input.eventTitle,
      eventStart: input.eventStart,
      source: input.source,
      createdAt: this.now().toISOString(),
    };
    await this.kv.set(LINK_KEY_PREFIX + link.id, JSON.stringify(link));
    return { link, created: true };
  }

  /** False when there was no such link. */
  async delete(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    await this.kv.delete(LINK_KEY_PREFIX + id);
    return true;
  }
}
