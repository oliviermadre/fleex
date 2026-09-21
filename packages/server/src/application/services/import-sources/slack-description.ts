import { ImportError } from '../../../domain/errors.js';
import type { SlackImportResult } from '../../ports/slack-import.port.js';

/**
 * The ticket description built from a Slack synthesis: the synthesis followed by
 * a `#### Source` footer. Single source of truth shared by the legacy async
 * import use-case and the new synchronous import adapter, so both produce the
 * exact same body.
 */
export function buildSlackDescription(synthesis: string, url: string): string {
  return `${synthesis.trim()}\n\n---\n\n#### Source\n\n- **Slack**: ${url}`;
}

/** Human-readable reason for a non-`ok` Slack result. Reused across surfaces. */
export function slackFailureReason(result: Exclude<SlackImportResult, { status: 'ok' }>): string {
  switch (result.status) {
    case 'integration_unavailable':
      return result.detail ?? "Claude's Slack integration is not available. Connect Slack to Claude and retry.";
    case 'inaccessible':
      return result.detail
        ? `Slack conversation could not be read: ${result.detail}`
        : 'Slack conversation could not be read (private channel, deleted message, or no access).';
    case 'empty':
      return 'Slack conversation has no content to summarize.';
  }
}

/** Map a non-`ok` Slack result to the generalised {@link ImportError} code. */
export function slackResultToImportError(result: Exclude<SlackImportResult, { status: 'ok' }>): ImportError {
  const message = slackFailureReason(result);
  switch (result.status) {
    case 'integration_unavailable':
      return new ImportError(message, 'IMPORT_SOURCE_UNAVAILABLE', 'slack_message');
    case 'inaccessible':
      return new ImportError(message, 'IMPORT_NOT_FOUND', 'slack_message');
    case 'empty':
      return new ImportError(message, 'IMPORT_EMPTY', 'slack_message');
  }
}
