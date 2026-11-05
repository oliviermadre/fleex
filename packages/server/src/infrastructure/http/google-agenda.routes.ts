/**
 * Google Calendar on /agenda (E3): connect / disconnect the instance's Google
 * account, read its status, and link deliverables to meetings (UI and CLI).
 * Everything is stored in the KV store; without one every route answers 501.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AgendaExternalLink, AgendaGoogleStatus } from '@fleex/shared';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleApiError,
  GoogleNotConnectedError,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
} from '../google/google-calendar.client.js';
import { ExternalLinksStore, eventKeyOf, eventStartOf, findMeeting } from '../google/external-links.js';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_COOKIE = 'fleex_gcal_state';
const RETURN_COOKIE = 'fleex_gcal_return';
const SHORT_COOKIE = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=600';
const CLEAR_COOKIE = 'Path=/; HttpOnly; Max-Age=0';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GoogleAgendaRoutesDeps {
  kvStore: KvStorePort | null | undefined;
  deliverableStore: Pick<DeliverableStorePort, 'getById'>;
  client: GoogleCalendarClient | null | undefined;
  logger?: LoggerPort;
  now?: () => Date;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`));
  return match ? match[1]! : null;
}

/**
 * Where Google sends the user back. Must be registered as an authorized
 * redirect URI on the OAuth client. Without AUTH_CALLBACK_BASE_URL it is the
 * server itself (PORT, 3000 by default).
 */
export function googleCalendarRedirectUri(): string {
  const base = process.env['AUTH_CALLBACK_BASE_URL'] || `http://localhost:${process.env['PORT'] || '3000'}`;
  return `${base.replace(/\/+$/, '')}/auth/google-calendar/callback`;
}

/**
 * The web origin to land back on after the consent screen. In dev the web app
 * (Vite) and the server listen on different ports: the callback hits the
 * server, so it must redirect to the web origin the user came from. Only
 * loopback origins and AUTH_CALLBACK_BASE_URL's origin are trusted (no open
 * redirect); anything else falls back to a relative redirect.
 */
export function safeReturnOrigin(candidate: string | undefined | null): string {
  if (!candidate) return '';
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  let configured = false;
  const base = process.env['AUTH_CALLBACK_BASE_URL'];
  if (base) {
    try {
      configured = new URL(base).origin === url.origin;
    } catch {
      configured = false;
    }
  }
  return loopback || configured ? url.origin : '';
}

/** [from, to) of a 'YYYY-MM-DD' day in the server's local time zone. */
export function localDayWindow(date: string): { from: Date; to: Date } | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const from = new Date(y, m - 1, d);
  if (from.getFullYear() !== y || from.getMonth() !== m - 1 || from.getDate() !== d) return null;
  return { from, to: new Date(y, m - 1, d + 1) };
}

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
      return reply.code(409).send({ error: `Google Calendar is not connected (${err.message}) — connect it from the /agenda page`, code: 'GOOGLE_NOT_CONNECTED' });
    }
    const message = err instanceof Error ? err.message : String(err);
    logger?.error('Google Calendar request failed', { error: message });
    const status = err instanceof GoogleApiError ? err.status : 0;
    return reply.code(502).send({ error: `Google Calendar request failed: ${message}`, code: 'GOOGLE_API_ERROR', status });
  }

  return async function (app: FastifyInstance) {
    // ── Status ──

    app.get('/api/agenda/google/status', async (_request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      const tokens = await r.client.getTokens();
      const status: AgendaGoogleStatus = {
        configured: r.client.isConfigured(),
        connected: tokens !== null,
        email: tokens?.email ?? null,
        calendars: [],
      };
      if (!tokens) return status;
      try {
        const calendars = await r.client.listCalendars();
        status.calendars = calendars.map((c) => ({
          id: c.id,
          name: c.summaryOverride || c.summary || c.id,
          primary: c.primary === true,
        }));
      } catch (err) {
        if (err instanceof GoogleNotConnectedError) {
          // The refresh token was rejected and dropped: report it as disconnected.
          return { ...status, connected: false, email: null };
        }
        logger?.warn('Google Calendar: listing calendars failed', { error: err instanceof Error ? err.message : String(err) });
      }
      return status;
    });

    // ── OAuth: connect ──

    app.get<{ Querystring: { return_to?: string } }>('/auth/google-calendar', async (request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      const returnOrigin = safeReturnOrigin(request.query.return_to ?? request.headers.referer);
      const clientId = r.client.clientId();
      if (!clientId) return reply.redirect(`${returnOrigin}/agenda?google_error=not_configured`);
      const state = randomBytes(16).toString('hex');
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: googleCalendarRedirectUri(),
        response_type: 'code',
        scope: GOOGLE_CALENDAR_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      reply.header('Set-Cookie', `${STATE_COOKIE}=${state}; ${SHORT_COOKIE}`);
      reply.header('Set-Cookie', `${RETURN_COOKIE}=${encodeURIComponent(returnOrigin)}; ${SHORT_COOKIE}`);
      return reply.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`);
    });

    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/auth/google-calendar/callback',
      async (request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>, reply) => {
        const r = ready(reply);
        if (!r) return reply;
        const returnOrigin = safeReturnOrigin(decodeURIComponent(parseCookie(request.headers.cookie, RETURN_COOKIE) ?? ''));
        const back = (query: string) => {
          reply.header('Set-Cookie', `${STATE_COOKIE}=; ${CLEAR_COOKIE}`);
          reply.header('Set-Cookie', `${RETURN_COOKIE}=; ${CLEAR_COOKIE}`);
          return reply.redirect(`${returnOrigin}/agenda?${query}`);
        };
        const { code, state, error } = request.query;
        if (error) {
          logger?.warn('Google Calendar consent refused', { error });
          return back(`google_error=${encodeURIComponent(error)}`);
        }
        if (!code || !state) return back('google_error=missing_params');
        if (state !== parseCookie(request.headers.cookie, STATE_COOKIE)) {
          logger?.warn('Google Calendar OAuth state mismatch');
          return back('google_error=state_mismatch');
        }
        try {
          const tokens = await r.client.exchangeCode(code, googleCalendarRedirectUri());
          logger?.info('Google Calendar connected', { email: tokens.email, offline: tokens.refreshToken !== null });
          return back('google=connected');
        } catch (err) {
          logger?.error('Google Calendar code exchange failed', { error: err instanceof Error ? err.message : String(err) });
          return back('google_error=exchange_failed');
        }
      },
    );

    // ── Disconnect ──

    app.delete('/api/agenda/google', async (_request, reply) => {
      const r = ready(reply);
      if (!r) return reply;
      await r.client.disconnect();
      return reply.code(204).send();
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
      if (!(await r.client.isConnected())) {
        return reply.code(409).send({ error: 'Google Calendar is not connected — connect it from the /agenda page', code: 'GOOGLE_NOT_CONNECTED' });
      }

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
