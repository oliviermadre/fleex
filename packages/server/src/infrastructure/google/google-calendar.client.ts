/**
 * Read-only Google Calendar client for the /agenda page (E3), on top of
 * gogcli (`gog`, https://gogcli.sh).
 *
 * Fleex never runs an OAuth flow nor stores Google tokens: gog is installed
 * on the server host (Homebrew) and set up there — Google Cloud project,
 * OAuth client, `gog auth add` — and Fleex shells out to it in read-only mode
 * (`--readonly --json --no-input`). The account read is gog's default one;
 * FLEEX_GOG_ACCOUNT (or gog's own GOG_ACCOUNT) picks another. FLEEX_GOG_BIN
 * overrides the binary path.
 *
 * Calendar lists are cached an hour and event windows five minutes, in memory.
 */
import { execFile } from 'node:child_process';
import type { LoggerPort } from '../../application/ports/logger.port.js';

const CALENDARS_TTL_MS = 3600_000;
const EVENTS_TTL_MS = 5 * 60_000;
const VERSION_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const GOG_TIMEOUT_MS = 30_000;
const GOG_MAX_BUFFER = 32 * 1024 * 1024;

/** gog's documented exit codes (`gog schema --json` → automation.exit_codes). */
export const GOG_EXIT = { usage: 2, auth_required: 4, not_found: 5, permission_denied: 6, rate_limited: 7, config: 10 } as const;

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The subset of a Calendar API `Event` the agenda reads (gog passes them through). */
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
  description?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    organizer?: boolean;
    optional?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }[];
}

export type GoogleRsvpStatus = 'accepted' | 'tentative' | 'declined';

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
}

/** gog can't read calendars yet: not installed, no OAuth client, no account. Setup happens outside Fleex. */
export class GoogleNotConnectedError extends Error {
  constructor(message = 'Google Calendar is not set up in gogcli') {
    super(message);
    this.name = 'GoogleNotConnectedError';
  }
}

/** `gog` is not on the server PATH (nor at FLEEX_GOG_BIN). */
export class GogNotInstalledError extends GoogleNotConnectedError {
  constructor(bin: string) {
    super(`gogcli is not installed on the Fleex server (\`${bin}\` not found) — brew install openclaw/tap/gogcli`);
    this.name = 'GogNotInstalledError';
  }
}

export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface GogResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The binary itself wasn't found (ENOENT). */
  notFound?: boolean;
}

export type GogRunner = (args: string[]) => Promise<GogResult>;

function defaultRunner(bin: string): GogRunner {
  return (args) => new Promise((resolve) => {
    execFile(bin, args, { timeout: GOG_TIMEOUT_MS, maxBuffer: GOG_MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr });
      const e = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
      if (e.code === 'ENOENT') return resolve({ code: 127, stdout: '', stderr: '', notFound: true });
      const code = typeof e.code === 'number' ? e.code : 1;
      resolve({ code, stdout: stdout ?? '', stderr: (stderr || (e.killed ? `gog timed out after ${GOG_TIMEOUT_MS / 1000}s` : e.message)) ?? '' });
    });
  });
}

function parseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** gog's error message: the `{"error":{class,message}}` envelope on stdout, else stderr. */
function gogError(res: GogResult): { message: string; cls: string | null } {
  const err = parseJson(res.stdout)?.['error'];
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; class?: unknown };
    if (typeof e.message === 'string') return { message: e.message.trim(), cls: typeof e.class === 'string' ? e.class : null };
  }
  return { message: res.stderr.trim().split('\n')[0] || `gog exited with code ${res.code}`, cls: null };
}

export interface GoogleCalendarClientDeps {
  /** Defaults to FLEEX_GOG_BIN, then `gog` on the PATH. */
  bin?: string;
  /** Defaults to FLEEX_GOG_ACCOUNT (gog falls back to GOG_ACCOUNT, then its default account). */
  account?: string | null;
  run?: GogRunner;
  now?: () => number;
  logger?: LoggerPort;
}

export class GoogleCalendarClient {
  readonly bin: string;
  private readonly account: string | null;
  private readonly run: GogRunner;
  private readonly now: () => number;
  private readonly logger: LoggerPort | undefined;
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(deps: GoogleCalendarClientDeps = {}) {
    this.bin = deps.bin ?? (process.env['FLEEX_GOG_BIN'] || 'gog');
    this.account = deps.account !== undefined ? deps.account : (process.env['FLEEX_GOG_ACCOUNT'] || null);
    this.run = deps.run ?? defaultRunner(this.bin);
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger;
  }

  /** Scriptable, never prompts; read-only unless `write` (an RSVP is the one write Fleex does). */
  private baseArgs(write = false): string[] {
    const args = ['--json', '--no-input', ...(write ? [] : ['--readonly']), '--color=never'];
    if (this.account) args.push('--account', this.account);
    return args;
  }

  /** Run a gog command; parsed JSON on success, typed errors otherwise. */
  private async gog(args: string[], write = false): Promise<Record<string, unknown>> {
    const res = await this.run([...this.baseArgs(write), ...args]);
    if (res.notFound) throw new GogNotInstalledError(this.bin);
    if (res.code === 0) {
      const body = parseJson(res.stdout);
      if (!body) throw new GoogleApiError(`gog ${args.slice(0, 2).join(' ')}: unreadable output`, 502);
      return body;
    }
    const { message, cls } = gogError(res);
    // Setup not done: no OAuth client (config), no / unknown account (usage), consent missing or expired (auth).
    if (res.code === GOG_EXIT.auth_required || res.code === GOG_EXIT.config || cls === 'auth' || cls === 'config'
      || (res.code === GOG_EXIT.usage && /account/i.test(message))) {
      throw new GoogleNotConnectedError(message);
    }
    const status = res.code === GOG_EXIT.not_found ? 404 : res.code === GOG_EXIT.permission_denied ? 403 : res.code === GOG_EXIT.rate_limited ? 429 : 502;
    throw new GoogleApiError(`gog ${args.slice(0, 2).join(' ')}: ${message}`, status);
  }

  /** `gog --version` ("v0.47.1"), null when gog isn't installed. */
  async version(): Promise<string | null> {
    const hit = this.cached<string | null>('version', VERSION_TTL_MS);
    if (hit !== undefined) return hit;
    const res = await this.run(['--version']);
    const value = res.notFound || res.code !== 0 ? null : (res.stdout.trim().split(/\s+/)[0] || null);
    this.remember('version', value);
    return value;
  }

  /** gog can read calendars with its current account. */
  async isConnected(): Promise<boolean> {
    try {
      await this.listCalendars();
      return true;
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) return false;
      throw err;
    }
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
    const body = await this.gog(['calendar', 'calendars', '--all']);
    const out = Array.isArray(body['calendars']) ? (body['calendars'] as GoogleCalendarListEntry[]) : [];
    this.remember('calendars', out);
    return out;
  }

  /** Every event (occurrences expanded) overlapping [from, to), ordered by start. */
  async listEvents(calendarId: string, from: Date, to: Date): Promise<GoogleCalendarEvent[]> {
    const key = `events|${calendarId}|${from.toISOString()}|${to.toISOString()}`;
    const hit = this.cached<GoogleCalendarEvent[]>(key, EVENTS_TTL_MS);
    if (hit) return hit;
    const body = await this.gog([
      'calendar', 'events', calendarId,
      '--from', from.toISOString(), '--to', to.toISOString(),
      '--all-pages', '--max', '250',
    ]);
    const out = Array.isArray(body['events']) ? (body['events'] as GoogleCalendarEvent[]) : [];
    this.remember(key, out);
    return out;
  }

  /** One event (or one occurrence, by its instance id); null when Google doesn't know it. */
  async getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent | null> {
    try {
      const body = await this.gog(['calendar', 'event', calendarId, eventId]);
      const event = (body['event'] && typeof body['event'] === 'object' ? body['event'] : body) as GoogleCalendarEvent;
      return typeof event.id === 'string' ? event : null;
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) return null;
      if (err instanceof GoogleApiError) this.logger?.warn('gog calendar event failed', { error: err.message });
      throw err;
    }
  }

  /**
   * My answer to an invitation (`gog calendar respond`). Needs a gog account
   * authorized with the calendar scope, not `--readonly`. Clears the cached
   * event windows so the next agenda read shows the answer.
   */
  async respond(calendarId: string, eventId: string, status: GoogleRsvpStatus): Promise<void> {
    await this.gog(['calendar', 'respond', calendarId, eventId, '--status', status], true);
    for (const key of [...this.cache.keys()]) if (key.startsWith('events|')) this.cache.delete(key);
  }
}
