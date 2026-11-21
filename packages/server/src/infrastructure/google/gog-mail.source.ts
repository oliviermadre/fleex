/**
 * The Factory's Gmail intakes, read through gogcli (`gog`, https://gogcli.sh): the one adapter of `MailSourcePort`
 * today. As for the agenda (`google-calendar.client.ts`), Fleex runs no OAuth flow and keeps no Google token: gog is
 * installed and authorized on the server host (`gog auth add you@example.com --services gmail --gmail-scope readonly`),
 * and Fleex runs it read-only (`--readonly --json --no-input`). FLEEX_GOG_ACCOUNT picks the account, FLEEX_GOG_BIN the
 * binary, as for the agenda.
 *
 * A pull is one `gog gmail messages search`, with the intake's query and `after:<epoch seconds>` (Gmail's own syntax),
 * every page of it, with each message's text, recipients and attachments.
 */
import { GOGCLI_SETUP_URL } from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import { MailSourceError, type MailMessage, type MailSourcePort, type MailSourceStatus } from '../../factory/mail-source.port.js';
import { GoogleApiError, GoogleNotConnectedError, defaultGogRunner, gogFailure, parseJson, type GogRunner } from './google-calendar.client.js';

const STATUS_TTL_MS = 60_000;

/** A message as `gog gmail messages search --json` writes it (gogcli's `messageItem`). */
interface GogMessage {
  id?: string; threadId?: string; date?: string; internalDateIso?: string;
  from?: string; to?: string; cc?: string; subject?: string; labels?: string[]; body?: string;
  attachments?: unknown[];
}

/** Where a person opens a thread in Gmail: in the account gog reads, when it is named. */
export function gmailThreadUrl(threadId: string, account: string | null): string {
  return `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : 'u/0/'}#all/${encodeURIComponent(threadId)}`;
}

/** The search a pull runs: the intake's query, grouped, and what came after the cursor. */
export function pullQuery(query: string, since: Date): string {
  const after = `after:${Math.floor(since.getTime() / 1000)}`;
  return query.trim() ? `(${query.trim()}) ${after}` : after;
}

export function mapGogMessage(m: GogMessage, account: string | null): MailMessage | null {
  if (!m.id || !m.threadId) return null;
  const when = Date.parse(m.internalDateIso ?? m.date ?? '');
  if (!Number.isFinite(when)) return null;
  return {
    id: m.id, threadId: m.threadId, at: new Date(when).toISOString(),
    from: m.from ?? '', to: m.to ?? '', cc: m.cc ?? '', subject: m.subject ?? '',
    body: (m.body ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    labels: Array.isArray(m.labels) ? m.labels.filter((l) => typeof l === 'string') : [],
    attachments: Array.isArray(m.attachments) ? m.attachments.length : 0,
    url: gmailThreadUrl(m.threadId, account),
  };
}

export interface GogMailSourceDeps {
  bin?: string;
  account?: string | null;
  run?: GogRunner;
  now?: () => number;
  logger?: LoggerPort;
}

export class GogMailSource implements MailSourcePort {
  readonly provider = 'gogcli';
  readonly bin: string;
  private readonly account: string | null;
  private readonly run: GogRunner;
  private readonly now: () => number;
  private statusCache: { at: number; value: MailSourceStatus } | null = null;

  constructor(deps: GogMailSourceDeps = {}) {
    this.bin = deps.bin ?? (process.env['FLEEX_GOG_BIN'] || 'gog');
    this.account = deps.account !== undefined ? deps.account : (process.env['FLEEX_GOG_ACCOUNT'] || null);
    this.run = deps.run ?? defaultGogRunner(this.bin);
    this.now = deps.now ?? Date.now;
  }

  private async gog(args: string[]): Promise<Record<string, unknown>> {
    const res = await this.run(['--json', '--no-input', '--readonly', '--color=never', ...(this.account ? ['--account', this.account] : []), ...args]);
    if (res.notFound) throw new MailSourceError(`gogcli is not installed on the Fleex server (\`${this.bin}\` not found)`, 'not_installed');
    if (res.code === 0) {
      const body = parseJson(res.stdout);
      if (!body) throw new MailSourceError('gog gmail: unreadable output', 'failed');
      return body;
    }
    const err = gogFailure(res, args);
    if (err instanceof GoogleNotConnectedError) throw new MailSourceError(`Gmail is not authorized in gogcli: ${err.message}`, 'not_connected');
    throw new MailSourceError(err.message, err instanceof GoogleApiError && err.status === 429 ? 'rate_limited' : err instanceof GoogleApiError && err.status === 403 ? 'not_connected' : 'failed');
  }

  async status(refresh = false): Promise<MailSourceStatus> {
    if (!refresh && this.statusCache && this.now() - this.statusCache.at < STATUS_TTL_MS) return this.statusCache.value;
    const value: MailSourceStatus = { provider: this.provider, installed: false, version: null, connected: false, account: this.account, error: null, setupUrl: GOGCLI_SETUP_URL };
    const v = await this.run(['--version']);
    if (!v.notFound && v.code === 0) {
      value.installed = true;
      value.version = v.stdout.trim().split(/\s+/)[0] || null;
      try {
        await this.gog(['gmail', 'messages', 'search', '--ids-only', '--max', '1', '--', 'newer_than:1d']);
        value.connected = true;
      } catch (err) {
        value.error = err instanceof Error ? err.message : String(err);
      }
    }
    this.statusCache = { at: this.now(), value };
    return value;
  }

  async search(query: string, since: Date): Promise<MailMessage[]> {
    const body = await this.gog([
      'gmail', 'messages', 'search', '--all', '--max', '100', '--include-body', '--include-recipients', '--include-attachments',
      '--', pullQuery(query, since),
    ]);
    const list = Array.isArray(body['messages']) ? (body['messages'] as GogMessage[]) : [];
    /* Gmail's `after:` is to the second; what the cursor already covered is let through, and the Factory knows it (`ItemInput.at`) */
    return list.map((m) => mapGogMessage(m, this.account)).filter((m): m is MailMessage => !!m).sort((a, b) => a.at.localeCompare(b.at));
  }
}
