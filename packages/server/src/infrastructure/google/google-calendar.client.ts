/**
 * Read-only Google Calendar client for the /agenda page (E3).
 *
 * One Google account per Fleex instance: the OAuth tokens live in the KV store
 * under `agenda:google:tokens`, like `agenda:prefs`. The access token is
 * refreshed (refresh_token grant) a minute before it expires; calendar lists
 * are cached an hour and event windows five minutes, in memory.
 */
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import { getGoogleConfig } from '../auth/oauth-providers.js';

export const GOOGLE_TOKENS_KEY = 'agenda:google:tokens';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly openid email';

const REFRESH_MARGIN_MS = 60_000;
const CALENDARS_TTL_MS = 3600_000;
const EVENTS_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const MAX_PAGES = 20;

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
  email: string | null;
  scope: string;
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The subset of a Calendar API `Event` the agenda reads. */
export interface GoogleCalendarEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  location?: string;
  eventType?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  recurringEventId?: string;
  originalStartTime?: GoogleEventTime;
  attendees?: { email?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
}

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
}

/** No tokens stored, or Google refused the refresh token: the user must reconnect. */
export class GoogleNotConnectedError extends Error {
  constructor(message = 'Google Calendar is not connected') {
    super(message);
    this.name = 'GoogleNotConnectedError';
  }
}

export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

type FetchFn = typeof fetch;

export interface GoogleCalendarClientDeps {
  kvStore: KvStorePort;
  fetch?: FetchFn;
  now?: () => number;
  /** Defaults to GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (the SSO client). */
  credentials?: () => GoogleCredentials | null;
  logger?: LoggerPort;
}

function defaultCredentials(): GoogleCredentials | null {
  const config = getGoogleConfig();
  return config ? { clientId: config.clientId, clientSecret: config.clientSecret } : null;
}

/** The `email` claim of an id_token, without verifying it (it comes straight from Google over TLS). */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    return typeof json['email'] === 'string' ? json['email'] : null;
  } catch {
    return null;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 200) };
  }
}

function errorText(body: Record<string, unknown>): string {
  const err = body['error'];
  if (typeof err === 'string') {
    const desc = body['error_description'];
    return typeof desc === 'string' ? `${err}: ${desc}` : err;
  }
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'unknown error';
}

export class GoogleCalendarClient {
  private readonly kv: KvStorePort;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly credentials: () => GoogleCredentials | null;
  private readonly logger: LoggerPort | undefined;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  /** One refresh at a time: parallel calendar reads share it. */
  private refreshing: Promise<GoogleTokens> | null = null;

  constructor(deps: GoogleCalendarClientDeps) {
    this.kv = deps.kvStore;
    this.fetchFn = deps.fetch ?? ((...args) => fetch(...args));
    this.now = deps.now ?? Date.now;
    this.credentials = deps.credentials ?? defaultCredentials;
    this.logger = deps.logger;
  }

  isConfigured(): boolean {
    return this.credentials() !== null;
  }

  /** The OAuth client id the consent screen is opened with; null when not configured. */
  clientId(): string | null {
    return this.credentials()?.clientId ?? null;
  }

  async getTokens(): Promise<GoogleTokens | null> {
    const raw = await this.kv.get(GOOGLE_TOKENS_KEY);
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as GoogleTokens;
      return typeof t.accessToken === 'string' ? t : null;
    } catch {
      return null;
    }
  }

  async isConnected(): Promise<boolean> {
    return (await this.getTokens()) !== null;
  }

  private async saveTokens(tokens: GoogleTokens): Promise<void> {
    await this.kv.set(GOOGLE_TOKENS_KEY, JSON.stringify(tokens));
  }

  private requireCredentials(): GoogleCredentials {
    const creds = this.credentials();
    if (!creds) throw new GoogleNotConnectedError('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
    return creds;
  }

  private async postForm(url: string, params: Record<string, string>): Promise<{ res: Response; body: Record<string, unknown> }> {
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
    return { res, body: await readJson(res) };
  }

  /** Authorization code → tokens (+ the account email), stored. */
  async exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
    const creds = this.requireCredentials();
    const { res, body } = await this.postForm(GOOGLE_TOKEN_URL, {
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const accessToken = body['access_token'];
    if (!res.ok || typeof accessToken !== 'string') {
      throw new GoogleApiError(`Google token exchange failed: ${errorText(body)}`, res.status);
    }
    let email = emailFromIdToken(body['id_token']);
    if (!email) {
      try {
        const info = await this.fetchFn(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await readJson(info);
        email = typeof data['email'] === 'string' ? data['email'] : null;
      } catch {
        email = null;
      }
    }
    const previous = await this.getTokens();
    const tokens: GoogleTokens = {
      accessToken,
      // Google only sends a refresh token on a consent screen; keep the old one otherwise.
      refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : previous?.refreshToken ?? null,
      expiresAt: this.now() + Number(body['expires_in'] ?? 3600) * 1000,
      email,
      scope: typeof body['scope'] === 'string' ? body['scope'] : GOOGLE_CALENDAR_SCOPE,
    };
    await this.saveTokens(tokens);
    this.cache.clear();
    return tokens;
  }

  private async refresh(tokens: GoogleTokens): Promise<GoogleTokens> {
    if (!tokens.refreshToken) {
      await this.kv.delete(GOOGLE_TOKENS_KEY);
      throw new GoogleNotConnectedError('The Google access token expired and there is no refresh token: reconnect Google Calendar');
    }
    const creds = this.requireCredentials();
    const { res, body } = await this.postForm(GOOGLE_TOKEN_URL, {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    });
    const accessToken = body['access_token'];
    if (!res.ok || typeof accessToken !== 'string') {
      if (body['error'] === 'invalid_grant') {
        // Revoked from the Google account page, or expired: the user has to reconnect.
        await this.kv.delete(GOOGLE_TOKENS_KEY);
        this.logger?.warn('Google Calendar refresh token rejected, tokens dropped', { error: errorText(body) });
        throw new GoogleNotConnectedError('Google refused the refresh token: reconnect Google Calendar');
      }
      throw new GoogleApiError(`Google token refresh failed: ${errorText(body)}`, res.status);
    }
    const next: GoogleTokens = {
      ...tokens,
      accessToken,
      refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : tokens.refreshToken,
      expiresAt: this.now() + Number(body['expires_in'] ?? 3600) * 1000,
      scope: typeof body['scope'] === 'string' ? body['scope'] : tokens.scope,
    };
    await this.saveTokens(next);
    return next;
  }

  /** A valid access token, refreshed when it expires within a minute. */
  async getAccessToken(force = false): Promise<string> {
    const tokens = await this.getTokens();
    if (!tokens) throw new GoogleNotConnectedError();
    if (!force && tokens.expiresAt - REFRESH_MARGIN_MS > this.now()) return tokens.accessToken;
    if (!this.refreshing) {
      this.refreshing = this.refresh(tokens).finally(() => { this.refreshing = null; });
    }
    return (await this.refreshing).accessToken;
  }

  /** GET on the Calendar API; one forced refresh + retry on a 401. */
  private async apiGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${GOOGLE_CALENDAR_API}${path}${qs ? `?${qs}` : ''}`;
    let token = await this.getAccessToken();
    let res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 401) {
      token = await this.getAccessToken(true);
      res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    }
    const body = await readJson(res);
    if (!res.ok) throw new GoogleApiError(`Google Calendar API ${res.status} on ${path}: ${errorText(body)}`, res.status);
    return body as T;
  }

  private cached<T>(key: string, ttl: number): T | undefined {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < ttl) return hit.value as T;
    return undefined;
  }

  private remember(key: string, value: unknown): void {
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), value });
    // Map keeps insertion order: the first key is the oldest write.
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  async listCalendars(): Promise<GoogleCalendarListEntry[]> {
    const hit = this.cached<GoogleCalendarListEntry[]>('calendars', CALENDARS_TTL_MS);
    if (hit) return hit;
    const out: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, string> = { maxResults: '250' };
      if (pageToken) params['pageToken'] = pageToken;
      const body = await this.apiGet<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>('/users/me/calendarList', params);
      out.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    this.remember('calendars', out);
    return out;
  }

  /** Every event (occurrences expanded) overlapping [from, to), ordered by start. */
  async listEvents(calendarId: string, from: Date, to: Date): Promise<GoogleCalendarEvent[]> {
    const key = `events|${calendarId}|${from.toISOString()}|${to.toISOString()}`;
    const hit = this.cached<GoogleCalendarEvent[]>(key, EVENTS_TTL_MS);
    if (hit) return hit;
    const out: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, string> = {
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        maxResults: '250',
      };
      if (pageToken) params['pageToken'] = pageToken;
      const body = await this.apiGet<{ items?: GoogleCalendarEvent[]; nextPageToken?: string }>(
        `/calendars/${encodeURIComponent(calendarId)}/events`, params,
      );
      out.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    this.remember(key, out);
    return out;
  }

  /** One event (or one occurrence, by its instance id); null when Google answers 404/410. */
  async getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent | null> {
    try {
      return await this.apiGet<GoogleCalendarEvent>(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return null;
      throw err;
    }
  }

  /** Revoke the grant at Google (best effort) and forget the tokens. */
  async disconnect(): Promise<void> {
    const tokens = await this.getTokens();
    const token = tokens?.refreshToken ?? tokens?.accessToken;
    if (token) {
      try {
        const { res, body } = await this.postForm(GOOGLE_REVOKE_URL, { token });
        if (!res.ok) this.logger?.warn('Google Calendar revoke failed', { status: res.status, error: errorText(body) });
      } catch (err) {
        this.logger?.warn('Google Calendar revoke failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    await this.kv.delete(GOOGLE_TOKENS_KEY);
    this.cache.clear();
  }
}
