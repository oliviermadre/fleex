/**
 * Google meetings as agenda items (E3): the external source the agenda use
 * case merges with Fleex's own items, read through gogcli. gog not set up →
 * no items, not an error;
 * an API failure throws so the use case reports it in `errors.external`.
 */
import type { AgendaAttendee, AgendaExternalLink, AgendaItem, AgendaRsvp } from '@fleex/shared';
import { GoogleNotConnectedError, type GoogleCalendarClient, type GoogleCalendarEvent } from './google-calendar.client.js';
import { eventKeyOf, type ExternalLinksStore } from './external-links.js';

/** Structurally identical to `AgendaExternalSource` in get-agenda.ts. */
export interface AgendaExternalSourceLike {
  list(from: Date, to: Date, calendarIds: string[]): Promise<AgendaItem[]>;
}

/** 'YYYY-MM-DD' one day before — Google's all-day `end.date` is exclusive, the agenda's is inclusive. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function toIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

const RSVPS: ReadonlySet<string> = new Set(['accepted', 'tentative', 'declined', 'needsAction']);
const asRsvp = (v: string | undefined): AgendaRsvp => (v && RSVPS.has(v) ? (v as AgendaRsvp) : 'needsAction');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Google stores event notes as light HTML (`<br>`, `<a>`, `<b>`, lists). The
 * card shows plain text: line breaks kept, a link's target kept next to its
 * label when they differ, every other tag dropped, entities decoded.
 */
export function notesToText(html: string | undefined | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/\r\n?/g, '\n')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, '').trim();
      return !l || l === href ? href : `${l} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

/** The video link: Meet's `hangoutLink`, else the conference's video entry point (Zoom, Teams…). */
export function meetUrlOf(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video' && e.uri);
  return video?.uri ?? null;
}

const RSVP_ORDER: Record<AgendaRsvp, number> = { accepted: 0, tentative: 1, needsAction: 2, declined: 3 };

/** Guests without rooms, organizer first, then me, then by answer and name. */
export function attendeesOf(event: GoogleCalendarEvent): AgendaAttendee[] {
  const organizerEmail = event.organizer?.email?.toLowerCase() ?? null;
  const list: AgendaAttendee[] = (event.attendees ?? [])
    .filter((a) => !a.resource && a.email)
    .map((a) => ({
      email: a.email!,
      name: a.displayName?.trim() || null,
      response: asRsvp(a.responseStatus),
      organizer: a.organizer === true || (organizerEmail !== null && a.email!.toLowerCase() === organizerEmail),
      self: a.self === true,
      optional: a.optional === true,
    }));
  const rank = (a: AgendaAttendee) => (a.organizer ? 0 : a.self ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b)
    || RSVP_ORDER[a.response] - RSVP_ORDER[b.response]
    || (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

/** One Google event → one agenda item; null for cancelled or start-less events. */
export function mapGoogleEvent(
  event: GoogleCalendarEvent,
  calendarId: string,
  links: AgendaExternalLink[] = [],
): AgendaItem | null {
  if (event.status === 'cancelled') return null;
  const eventKey = eventKeyOf(event);
  const self = event.attendees?.find((a) => a.self);
  const attendeeList = attendeesOf(event);
  // I can answer when I'm a guest; an organizer's own event has nothing to answer.
  const iOrganize = event.organizer?.self === true || self?.organizer === true;
  const rsvp = self && !iOrganize ? asRsvp(self.responseStatus) : null;
  const organizer = event.organizer?.email
    ? { email: event.organizer.email, name: event.organizer.displayName?.trim() || null, self: event.organizer.self === true }
    : null;
  const base = {
    id: `external:${eventKey}`,
    type: 'external' as const,
    title: event.summary?.trim() || '(no title)',
    status: self?.responseStatus ?? null,
    external: {
      calendarId,
      eventKey,
      eventId: event.id,
      htmlLink: event.htmlLink ?? null,
      attendees: attendeeList.length,
      location: event.location ?? null,
      meetUrl: meetUrlOf(event),
      description: notesToText(event.description),
      organizer,
      attendeeList,
      rsvp,
      canRespond: rsvp !== null,
      eventType: event.eventType ?? 'default',
      links,
    },
  };
  if (event.start?.date) {
    const start = event.start.date;
    const endExclusive = event.end?.date;
    const end = endExclusive && endExclusive > start ? dayBefore(endExclusive) : start;
    return { ...base, shape: 'allDay', start, end };
  }
  if (event.start?.dateTime) {
    return {
      ...base,
      shape: 'block',
      start: toIso(event.start.dateTime),
      end: event.end?.dateTime ? toIso(event.end.dateTime) : null,
    };
  }
  return null;
}

export class GoogleAgendaSource implements AgendaExternalSourceLike {
  constructor(
    private readonly client: Pick<GoogleCalendarClient, 'listEvents'>,
    private readonly links: Pick<ExternalLinksStore, 'byEventKey'>,
  ) {}

  async list(from: Date, to: Date, calendarIds: string[]): Promise<AgendaItem[]> {
    const ids = calendarIds.length > 0 ? [...new Set(calendarIds)] : ['primary'];
    let perCalendar: GoogleCalendarEvent[][];
    try {
      perCalendar = await Promise.all(ids.map((id) => this.client.listEvents(id, from, to)));
    } catch (err) {
      // gogcli not installed or not set up yet: no Google items, not an error (the sidebar explains the setup).
      if (err instanceof GoogleNotConnectedError) return [];
      throw err;
    }
    const linksByKey = await this.links.byEventKey();
    const items = new Map<string, AgendaItem>();
    perCalendar.forEach((events, i) => {
      for (const event of events) {
        const item = mapGoogleEvent(event, ids[i]!, linksByKey.get(eventKeyOf(event)) ?? []);
        // A meeting shared by two selected calendars shows once (same iCalUID).
        if (item && !items.has(item.id)) items.set(item.id, item);
      }
    });
    return [...items.values()];
  }
}
