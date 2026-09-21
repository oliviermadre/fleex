import type { ParsedSlackMessageUrl } from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { SlackImportPort, SlackImportResult, SlackThreadSynthesizerPort } from '../../application/ports/slack-import.port.js';
import type { SlackConnection, SlackConnectionStore } from '../../application/ports/slack-connection.port.js';
import { collectUserIds, formatSlackTranscript } from '../../domain/services/slack-transcript.js';
import { SlackApiError, type SlackWebApiClient } from './slack-web-api.client.js';

const TOKEN_PROBLEMS = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'no_permission']);
const NOT_VISIBLE = new Set(['channel_not_found', 'thread_not_found', 'message_not_found', 'not_in_channel', 'is_archived']);

/**
 * Reads a Slack conversation the cheapest way available.
 *
 * With a saved token for the link's workspace, Fleex fetches the messages from
 * the Slack API itself and asks Claude for ONE thing — the summary of a text it
 * is handed. Without one, it falls back to the original path, where an agent
 * discovers and calls the user's Slack MCP tools turn by turn: that loop is what
 * made the import slow and expensive.
 *
 * Sits behind {@link SlackImportPort}, so both the New Task flow and the legacy
 * kanban import get the fast path with no change of their own.
 */
export class SlackImportRouter implements SlackImportPort {
  constructor(
    private readonly connections: SlackConnectionStore,
    private readonly api: Pick<SlackWebApiClient, 'fetchConversation' | 'fetchUserNames'>,
    private readonly synthesizer: SlackThreadSynthesizerPort,
    private readonly claudeFallback: SlackImportPort,
    private readonly logger: LoggerPort,
  ) {}

  async synthesizeThread(parsed: ParsedSlackMessageUrl, opts?: { signal?: AbortSignal }): Promise<SlackImportResult> {
    const connection = await this.connections.get();
    // A token only sees its own workspace: a link from elsewhere is not "a token
    // we have", so it takes the fallback rather than a guaranteed channel_not_found.
    if (!connection || connection.teamDomain.toLowerCase() !== parsed.workspace.toLowerCase()) {
      return this.claudeFallback.synthesizeThread(parsed, opts);
    }
    return this.readDirectly(connection, parsed, opts?.signal);
  }

  private async readDirectly(connection: SlackConnection, parsed: ParsedSlackMessageUrl, signal?: AbortSignal): Promise<SlackImportResult> {
    const startedAt = Date.now();
    try {
      // Replies only come back when asked from the thread ROOT.
      const messages = await this.api.fetchConversation(connection.token, parsed.channelId, parsed.threadTs ?? parsed.ts, signal);
      const names = await this.api.fetchUserNames(connection.token, collectUserIds(messages), signal);
      const transcript = formatSlackTranscript(messages, names);
      if (!transcript) return { status: 'empty' };

      const summary = await this.synthesizer.synthesize(transcript, { signal });
      this.logger.info('Slack conversation read through the API', {
        channelId: parsed.channelId, messages: messages.length, ms: Date.now() - startedAt,
      });
      return summary ? { status: 'ok', ...summary } : { status: 'empty' };
    } catch (err) {
      if (signal?.aborted) return { status: 'inaccessible', detail: 'Import cancelled' };
      if (err instanceof SlackApiError) return this.fromSlackError(err, parsed);
      // Deliberately no `String(err)`: nothing downstream of a token goes to the logs verbatim.
      this.logger.error('Slack direct import failed', { channelId: parsed.channelId, kind: err instanceof Error ? err.name : 'unknown' });
      throw new Error('Slack import failed while reading or summarising the conversation');
    }
  }

  /**
   * A broken token is reported, NOT papered over with the Claude path: a silent
   * fallback would hide a revoked token forever behind "Slack is slow again".
   */
  private fromSlackError(err: SlackApiError, parsed: ParsedSlackMessageUrl): SlackImportResult {
    this.logger.warn('Slack API refused the read', { channelId: parsed.channelId, code: err.code });
    if (TOKEN_PROBLEMS.has(err.code)) {
      return { status: 'integration_unavailable', detail: `Slack rejected the saved token (${err.code}). Replace it in Settings → Connectors.` };
    }
    if (err.code === 'missing_scope') {
      return {
        status: 'integration_unavailable',
        detail: `The Slack token is missing the ${err.needed ?? 'required'} scope. Add it to your Slack app, reinstall it, and update the token in Settings → Connectors.`,
      };
    }
    if (NOT_VISIBLE.has(err.code)) return { status: 'inaccessible' };
    if (err.code === 'ratelimited') return { status: 'inaccessible', detail: 'Slack is rate-limiting requests. Wait a moment and retry.' };
    return { status: 'inaccessible', detail: `Slack answered "${err.code}".` };
  }
}
