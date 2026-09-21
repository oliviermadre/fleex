import type { SlackMessage } from '../../domain/services/slack-transcript.js';

const API = 'https://slack.com/api';
/** Hard stop on a runaway thread: 10 pages of 200 is far beyond any ticket-worthy discussion. */
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15_000;

/** A Slack API refusal (`ok: false`), a transport failure (`http_<status>`), or a rate limit. */
export class SlackApiError extends Error {
  constructor(
    /** Slack's own error code: `invalid_auth`, `channel_not_found`, `missing_scope`, `ratelimited`… */
    readonly code: string,
    /** For `missing_scope`: the scope Slack says it needed. */
    readonly needed?: string,
  ) {
    super(`Slack API error: ${code}`);
    this.name = 'SlackApiError';
  }
}

export interface SlackIdentity {
  readonly teamId: string;
  readonly teamName: string;
  /** Workspace subdomain — `acme` for `https://acme.slack.com/`. Matches a permalink's host. */
  readonly teamDomain: string;
  readonly userId: string;
  readonly userName: string;
  /** Scopes granted to the token, from the `x-oauth-scopes` response header. */
  readonly scopes: string[];
}

type FetchFn = typeof globalThis.fetch;

/**
 * The three Slack Web API calls Fleex needs. The token travels in the
 * `Authorization` header only — never in a URL (URLs end up in logs and proxies)
 * and never in an error message.
 */
export class SlackWebApiClient {
  constructor(private readonly fetchFn: FetchFn = (...args) => globalThis.fetch(...args)) {}

  /** Who does this token belong to? Doubles as the validity check when saving it. */
  async authTest(token: string, signal?: AbortSignal): Promise<SlackIdentity> {
    const { body, headers } = await this.call<{ team_id: string; team: string; url: string; user_id: string; user: string }>(
      token, 'auth.test', {}, signal,
    );
    return {
      teamId: body.team_id,
      teamName: body.team,
      teamDomain: /^https?:\/\/([^.]+)\./.exec(body.url ?? '')?.[1] ?? '',
      userId: body.user_id,
      userName: body.user,
      scopes: (headers.get('x-oauth-scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  }

  /**
   * A message with its thread. `ts` must be the thread ROOT for replies to come
   * back; given a plain message, Slack returns just that message.
   */
  async fetchConversation(token: string, channel: string, ts: string, signal?: AbortSignal): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    let cursor = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const { body } = await this.call<{ messages?: SlackMessage[]; response_metadata?: { next_cursor?: string } }>(
        token, 'conversations.replies', { channel, ts, limit: '200', ...(cursor ? { cursor } : {}) }, signal,
      );
      messages.push(...(body.messages ?? []));
      cursor = body.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
    return messages;
  }

  /** Display names for the given ids. A user that can't be read is left out, never fatal. */
  async fetchUserNames(token: string, ids: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const { body } = await this.call<{ user?: { name?: string; real_name?: string; profile?: { display_name?: string } } }>(
            token, 'users.info', { user: id }, signal,
          );
          const name = body.user?.profile?.display_name || body.user?.real_name || body.user?.name;
          if (name) names.set(id, name);
        } catch (err) {
          // Names are a nicety: without `users:read` the transcript keeps the ids.
          if (signal?.aborted) throw err;
        }
      }),
    );
    return names;
  }

  private async call<T>(token: string, method: string, params: Record<string, string>, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const res = await this.fetchFn(`${API}/${method}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (res.status === 429) throw new SlackApiError('ratelimited');
    if (!res.ok) throw new SlackApiError(`http_${res.status}`);
    const body = (await res.json()) as T & { ok: boolean; error?: string; needed?: string };
    if (!body.ok) throw new SlackApiError(body.error ?? 'unknown_error', body.needed);
    return { body, headers: res.headers };
  }
}
