/**
 * Google meetings as agenda items (E3): the external source the agenda use
 * case merges with Fleex's own items. Not connected → no items, not an error;
 * an API failure throws so the use case reports it in `errors.external`.
 */
import type { AgendaExternalLink, AgendaItem } from '@fleex/shared';
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

/** One Google event → one agenda item; null for cancelled or start-less events. */
export function mapGoogleEvent(
  event: GoogleCalendarEvent,
  calendarId: string,
  links: AgendaExternalLink[] = [],
): AgendaItem | null {
  if (event.status === 'cancelled') return null;
  const eventKey = eventKeyOf(event);
  const self = event.attendees?.find((a) => a.self);
  const base = {
    id: `external:${eventKey}`,
    type: 'external' as const,
    title: event.summary?.trim() || '(no title)',
    status: self?.responseStatus ?? null,
    external: {
      calendarId,
      eventKey,
      htmlLink: event.htmlLink ?? null,
      attendees: (event.attendees ?? []).filter((a) => !a.resource).length,
      location: event.location ?? null,
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
    private readonly client: Pick<GoogleCalendarClient, 'isConnected' | 'listEvents'>,
    private readonly links: Pick<ExternalLinksStore, 'byEventKey'>,
  ) {}

  async list(from: Date, to: Date, calendarIds: string[]): Promise<AgendaItem[]> {
    if (!(await this.client.isConnected())) return [];
    const ids = calendarIds.length > 0 ? [...new Set(calendarIds)] : ['primary'];
    let perCalendar: GoogleCalendarEvent[][];
    try {
      perCalendar = await Promise.all(ids.map((id) => this.client.listEvents(id, from, to)));
    } catch (err) {
      // Tokens dropped mid-request (refresh token revoked): same as never connected.
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
