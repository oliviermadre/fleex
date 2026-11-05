import type { AgendaExternalLink } from '@fleex/shared';
import { actorHeaders } from '../../core/actor.ts';

export type { AgendaExternalLink };

/** A failed call to the agenda API, with the server's error code when it sent one. */
export class AgendaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly candidates: { googleEventId: string; title: string; start: string }[] = [],
  ) {
    super(message);
    this.name = 'AgendaApiError';
  }
}

/**
 * Like `apiCall`, but keeps the error body's `code` (and the candidates of an
 * ambiguous match) so the command can say what to do next.
 */
export async function agendaRequest<T>(method: string, url: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { ...actorHeaders() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetchFn(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new AgendaApiError(`API request failed: ${method} ${url} (connection error — is the instance started?)`, 0, null);
  }
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message = typeof json?.['error'] === 'string' ? json['error'] : text || `HTTP ${res.status}`;
    const code = typeof json?.['code'] === 'string' ? json['code'] : null;
    const candidates = Array.isArray(json?.['candidates']) ? (json['candidates'] as AgendaApiError['candidates']) : [];
    throw new AgendaApiError(message, res.status, code, candidates);
  }
  return { status: res.status, data: json as T };
}

/** The message `die` prints for a failed agenda call — actionable for the codes the server knows. */
export function describeAgendaError(err: unknown): string {
  if (!(err instanceof AgendaApiError)) return err instanceof Error ? err.message : String(err);
  switch (err.code) {
    case 'GOOGLE_NOT_CONNECTED':
      return 'Google Calendar is read through gogcli, which is not set up on the Fleex server. Install it (brew install openclaw/tap/gogcli), authorize your account (gog auth add you@example.com --services calendar), then retry. Setup guide: https://gogcli.sh/quickstart.html';
    case 'EVENT_NOT_FOUND':
      return `Meeting not found: ${err.message}. Check --google-event / --calendar, or the --match-title and --date (server local day).`;
    case 'AMBIGUOUS_EVENT': {
      const list = err.candidates.map((c) => `\n  ${c.googleEventId}  ${c.start}  ${c.title}`).join('');
      return `${err.message}${list}\nRetry with --google-event <id>.`;
    }
    case 'DELIVERABLE_NOT_FOUND':
      return `${err.message}. Use the deliverable UUID (fleex ticket deliverable list <ticket>).`;
    case 'UNAVAILABLE':
      return 'Google Calendar links need a KV store, which this storage does not provide.';
    default:
      return err.status ? `API error (HTTP ${err.status}): ${err.message}` : err.message;
  }
}

/** One line per link, for the human output. */
export function formatLink(l: AgendaExternalLink): string {
  return `${l.id}  ${l.eventStart}  ${l.eventTitle}  ←  ${l.deliverableTitle} (${l.deliverableId})`;
}
