import type { ParsedSlackMessageUrl } from '@fleex/shared';

/**
 * Outcome of asking Claude's native Slack integration to read a message (and
 * its thread, when applicable) and synthesize it.
 *
 * Discriminated on `status`:
 *  - `ok`                      → a usable synthesis was produced.
 *  - `integration_unavailable` → no Slack tool was reachable (US5). The user
 *                                must connect Slack to Claude. Surfaced as the
 *                                "fleex doctor can't check Slack" path.
 *  - `inaccessible`            → the conversation exists but could not be read,
 *                                e.g. private channel the integration can't see
 *                                or a deleted message (US6).
 *  - `empty`                   → the message/thread was reached but contained no
 *                                useful content to summarize.
 */
export type SlackImportResult =
  | {
      readonly status: 'ok';
      /** Short, human-readable title derived from the synthesis (Slack messages have none). */
      readonly title: string;
      /** Faithful markdown synthesis of the message + thread. Becomes the ticket description. */
      readonly synthesis: string;
    }
  | { readonly status: 'integration_unavailable' }
  | { readonly status: 'inaccessible'; readonly detail?: string }
  | { readonly status: 'empty' };

/**
 * Port for retrieving and synthesizing a Slack conversation. The concrete
 * adapter delegates to Claude via the Agent SDK, relying on the user's native
 * Slack integration. Fleex never authenticates to Slack itself, never
 * configures an MCP server, and never stores raw Slack content — only the
 * synthesis returned here is persisted.
 */
export interface SlackImportPort {
  synthesizeThread(parsed: ParsedSlackMessageUrl): Promise<SlackImportResult>;
}
