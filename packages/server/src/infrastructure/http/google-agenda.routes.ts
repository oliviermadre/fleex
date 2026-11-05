/**
 * Google Calendar on /agenda (E3): status of the gogcli setup the agenda reads
 * Google through, and deliverable ↔ meeting links (UI and CLI). There is no
 * connect / disconnect here: gogcli is installed and authorized on the server
 * host, outside Fleex (https://gogcli.sh/quickstart.html). Links live in the
 * KV store; without one every route answers 501.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { GOGCLI_SETUP_URL, type AgendaExternalLink, type AgendaGoogleStatus } from '@fleex/shared';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import {
  GoogleApiError,
  GoogleNotConnectedError,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  type GoogleRsvpStatus,
} from '../google/google-calendar.client.js';
import { ExternalLinksStore, eventKeyOf, eventStartOf, findMeeting } from '../google/external-links.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_SET_UP = `Google Calendar is read through gogcli, which isn't set up on the Fleex server — see ${GOGCLI_SETUP_URL}`;

export interface GoogleAgendaRoutesDeps {
  kvStore: KvStorePort | null | undefined;
  deliverableStore: Pick<DeliverableStorePort, 'getById'>;
  client: GoogleCalendarClient | null | undefined;
  logger?: LoggerPort;
  now?: () => Date;
}

/** [from, to) of a 'YYYY-MM-DD' day in the server's local time zone. */
export function localDayWindow(date: string): { from: Date; to: Date } | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const from = new Date(y, m - 1, d);
  if (from.getFullYear() !== y || from.getMonth() !== m - 1 || from.getDate() !== d) return null;
  return { from, to: new Date(y, m - 1, d + 1) };
}

const RSVP_STATUSES: ReadonlySet<string> = new Set<GoogleRsvpStatus>(['accepted', 'tentative', 'declined']);
/** An RSVP writes to Google: gog's account needs the calendar scope, not the read-only one. */
export const RSVP_SCOPE_HINT = 'Answering an invitation writes to Google Calendar: authorize gog with write access — '
  + 'gog auth add you@example.com --services calendar (without --readonly)';

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function googleAgendaRoutes(deps: GoogleAgendaRoutesDeps) {
  const { kvStore, deliverableStore, client, logger } = deps;
  const links = kvStore ? new ExternalLinksStore(kvStore, deps.now) : null;

  /** 501 when the storage has no KV store; narrows the deps otherwise. */
  function ready(reply: FastifyReply): { client: GoogleCalendarClient; links: ExternalLinksStore } | null {
    if (!kvStore || !client || !links) {
      void reply.code(501).send({ error: 'Google Calendar is unavailable on this storage', code: 'UNAVAILABLE' });
      return null;
    }
    return { client, links };
  }

  function googleFailure(reply: FastifyReply, err: unknown) {
    if (err instanceof GoogleNotConnectedError) {
      return reply.code(409).send({ error: `${NOT_SET_UP} (${err.message})`, code: 'GOOGLE_NOT_CONNECTED', setupUrl: GOGCLI_SETUP_URL });
    }
    const message = err instanceof Error ? err.message : String(err);
    logger?.error('Google Calendar request (gog) failed', { error: message });
    const status = err instanceof GoogleApiError ? err.status : 0;
    return reply.code(502).send({ error: `Google Calendar request failed: ${message}`, code: 'GOOGLE_API_ERROR', status });
  }

  return async function (app: FastifyInstance) {
    // ── Status: is gogcli installed and authorized? ──

    app.get<{ Querystring: { refresh?: string } }>('/api/agenda/google/status', async (request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      // "Check again" after running gog commands: don't serve the cached answer.
      if (request.query.refresh) r.client.clearCache();
      const version = await r.client.version();
      const status: AgendaGoogleStatus = {
        provider: 'gogcli', installed: version !== null, version,
        connected: false, email: null, calendars: [], error: null, setupUrl: GOGCLI_SETUP_URL,
      };
      if (!version) return status;
      try {
        const calendars = await r.client.listCalendars();
        status.connected = true;
        status.calendars = calendars.map((c) => ({
          id: c.id,
          name: c.summaryOverride || c.summary || c.id,
          primary: c.primary === true,
        }));
        // The primary calendar's id is the account's email.
        status.email = calendars.find((c) => c.primary)?.id ?? null;
      } catch (err) {
        status.error = err instanceof Error ? err.message : String(err);
        if (!(err instanceof GoogleNotConnectedError)) {
          // gog is set up but the read failed (network, quota): report it, don't call it a setup problem.
          status.connected = true;
          logger?.warn('Google Calendar: listing calendars through gog failed', { error: status.error });
        }
      }
      return status;
    });

    // ── My answer to an invitation (the one write to Google) ──

    app.post<{ Body: unknown }>('/api/agenda/google/respond', async (request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { calendarId, eventId, status } = body;
      if (!isNonEmpty(calendarId) || !isNonEmpty(eventId)) {
        return reply.code(400).send({ error: 'calendarId and eventId are required', code: 'INVALID_BODY' });
      }
      if (typeof status !== 'string' || !RSVP_STATUSES.has(status)) {
        return reply.code(400).send({ error: 'status must be accepted, tentative or declined', code: 'INVALID_BODY' });
      }
      try {
        await r.client.respond(calendarId, eventId, status as GoogleRsvpStatus);
      } catch (err) {
        // A read-only token: Google answers "insufficient scopes" (403) or gog asks for consent again.
        if (err instanceof GoogleNotConnectedError || (err instanceof GoogleApiError && err.status === 403)) {
          return reply.code(409).send({
            error: `${RSVP_SCOPE_HINT} (${err.message})`,
            code: 'GOOGLE_WRITE_NOT_AUTHORIZED',
            setupUrl: GOGCLI_SETUP_URL,
          });
        }
        if (err instanceof GoogleApiError && err.status === 404) {
          return reply.code(404).send({ error: `No Google event ${eventId} in calendar ${calendarId}`, code: 'EVENT_NOT_FOUND' });
        }
        return googleFailure(reply, err);
      }
      return { calendarId, eventId, status };
    });

    // ── Links ──

    app.get<{ Querystring: { deliverableId?: string; eventKey?: string } }>('/api/agenda/external-links', async (request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      const { deliverableId, eventKey } = request.query;
      return { links: await r.links.list({ deliverableId: deliverableId || undefined, eventKey: eventKey || undefined }) };
    });

    app.post<{ Body: unknown }>('/api/agenda/external-links', async (request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { eventKey, deliverableId, eventTitle, eventStart, source } = body;
      if (!isNonEmpty(eventKey) || !isNonEmpty(deliverableId)) {
        return reply.code(400).send({ error: 'eventKey and deliverableId are required', code: 'INVALID_BODY' });
      }
      if (typeof eventTitle !== 'string' || typeof eventStart !== 'string') {
        return reply.code(400).send({ error: 'eventTitle and eventStart must be strings', code: 'INVALID_BODY' });
      }
      if (source !== undefined && source !== 'manual' && source !== 'cli') {
        return reply.code(400).send({ error: 'source must be manual or cli', code: 'INVALID_BODY' });
      }
      const deliverable = await deliverableStore.getById(deliverableId);
      if (!deliverable) return reply.code(404).send({ error: `Deliverable ${deliverableId} not found`, code: 'DELIVERABLE_NOT_FOUND' });
      const { link, created } = await r.links.create({
        eventKey,
        deliverableId,
        deliverableTitle: deliverable.title,
        eventTitle,
        eventStart,
        source: source ?? 'manual',
      });
      return reply.code(created ? 201 : 200).send(link);
    });

    app.delete<{ Params: { id: string } }>('/api/agenda/external-links/:id', async (request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      const removed = await r.links.delete(request.params.id);
      if (!removed) return reply.code(404).send({ error: `Link ${request.params.id} not found`, code: 'LINK_NOT_FOUND' });
      return reply.code(204).send();
    });

    // ── CLI: link a deliverable to a meeting found in Google ──

    app.post<{ Body: unknown }>('/api/agenda/google/link', async (request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { deliverableId, googleEventId, matchTitle, date } = body;
      const calendarId = isNonEmpty(body['calendarId']) ? body['calendarId'] : 'primary';
      if (!isNonEmpty(deliverableId)) return reply.code(400).send({ error: 'deliverableId is required', code: 'INVALID_BODY' });
      if (!isNonEmpty(googleEventId) && !(isNonEmpty(matchTitle) && isNonEmpty(date))) {
        return reply.code(400).send({ error: 'give googleEventId, or matchTitle with date (YYYY-MM-DD)', code: 'INVALID_BODY' });
      }
      const window = isNonEmpty(googleEventId) ? null : localDayWindow(date as string);
      if (!isNonEmpty(googleEventId) && !window) {
        return reply.code(400).send({ error: `date must be a valid YYYY-MM-DD day, got "${String(date)}"`, code: 'INVALID_BODY' });
      }

      const deliverable = await deliverableStore.getById(deliverableId);
      if (!deliverable) return reply.code(404).send({ error: `Deliverable ${deliverableId} not found`, code: 'DELIVERABLE_NOT_FOUND' });
      let event: GoogleCalendarEvent | null;
      try {
        if (isNonEmpty(googleEventId)) {
          event = await r.client.getEvent(calendarId, googleEventId);
          if (event?.status === 'cancelled') event = null;
          if (!event) {
            return reply.code(404).send({ error: `No Google event ${googleEventId} in calendar ${calendarId}`, code: 'EVENT_NOT_FOUND' });
          }
        } else {
          const events = await r.client.listEvents(calendarId, window!.from, window!.to);
          const found = findMeeting(events, matchTitle as string);
          if (found.length === 0) {
            return reply.code(404).send({
              error: `No meeting matching "${String(matchTitle)}" on ${String(date)} in calendar ${calendarId}`,
              code: 'EVENT_NOT_FOUND',
            });
          }
          if (found.length > 1) {
            return reply.code(409).send({
              error: `${found.length} meetings match "${String(matchTitle)}" on ${String(date)} — pass --google-event <id> or a more precise title`,
              code: 'AMBIGUOUS_EVENT',
              candidates: found.map((e) => ({ googleEventId: e.id, title: e.summary ?? '(no title)', start: eventStartOf(e) })),
            });
          }
          event = found[0]!;
        }
      } catch (err) {
        return googleFailure(reply, err);
      }

      const { link, created } = await r.links.create({
        eventKey: eventKeyOf(event),
        deliverableId,
        deliverableTitle: deliverable.title,
        eventTitle: event.summary?.trim() || '(no title)',
        eventStart: eventStartOf(event),
        source: 'cli',
      });
      return reply.code(created ? 201 : 200).send(link satisfies AgendaExternalLink);
    });
  };
}
