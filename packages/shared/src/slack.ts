/**
 * Parsing utilities for Slack message permalinks.
 *
 * Slack message links look like:
 *   https://<workspace>.slack.com/archives/<channelId>/p<digits>
 *   https://<workspace>.slack.com/archives/<channelId>/p<digits>?thread_ts=<ts>&cid=<channelId>
 *
 * The `p<digits>` segment encodes the message timestamp: the digits are the
 * Slack `ts` value (seconds.microseconds) with the dot removed. For example
 * `p1700000000123456` corresponds to the message ts `1700000000.123456`.
 *
 * This module is the single source of truth used by both the frontend (to
 * detect a pasted Slack link in the ticket-creation field) and the backend
 * (to validate the link before delegating retrieval to Claude's native Slack
 * integration). It is purely syntactic — it never contacts Slack.
 */

/**
 * Matches a Slack message permalink. A trailing slash and the query string are
 * both optional, mirroring the leniency of the GitHub-issue matcher so a stray
 * slash from the clipboard does not break detection.
 */
export const SLACK_MESSAGE_URL_RE =
  /^https?:\/\/([a-z0-9][a-z0-9-]*)\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d{16,})\/?(?:\?[^\s]*)?$/i;

export interface ParsedSlackMessageUrl {
  /** Workspace subdomain, e.g. `acme` for `acme.slack.com`. */
  readonly workspace: string;
  /** Channel / conversation id, e.g. `C0123ABCD` or `D0123ABCD`. */
  readonly channelId: string;
  /** Message timestamp in Slack `ts` form, e.g. `1700000000.123456`. */
  readonly ts: string;
  /**
   * Parent thread timestamp when the link points to a threaded reply
   * (`?thread_ts=...`). `null` when the link targets a root message.
   */
  readonly threadTs: string | null;
  /** The original, normalized URL that was parsed. */
  readonly url: string;
}

/**
 * Converts the `p<digits>` permalink segment into a Slack `ts` string by
 * inserting the decimal point before the last 6 digits (microseconds).
 */
function pSegmentToTs(digits: string): string {
  const seconds = digits.slice(0, digits.length - 6);
  const micros = digits.slice(digits.length - 6);
  return `${seconds}.${micros}`;
}

/**
 * Parses a Slack message permalink. Returns `null` when the input is not a
 * recognizable Slack message URL.
 */
export function parseSlackMessageUrl(url: string): ParsedSlackMessageUrl | null {
  const trimmed = url.trim();
  const match = SLACK_MESSAGE_URL_RE.exec(trimmed);
  if (!match) return null;

  const [, workspace, channelId, pDigits] = match;
  if (!workspace || !channelId || !pDigits) return null;

  let threadTs: string | null = null;
  const queryIndex = trimmed.indexOf('?');
  if (queryIndex !== -1) {
    const params = new URLSearchParams(trimmed.slice(queryIndex + 1));
    const rawThreadTs = params.get('thread_ts');
    // Only keep thread_ts when it differs from the message ts; a link whose
    // thread_ts equals its own ts is just the thread root, not a reply.
    if (rawThreadTs && rawThreadTs !== pSegmentToTs(pDigits)) {
      threadTs = rawThreadTs;
    }
  }

  return {
    workspace,
    channelId,
    ts: pSegmentToTs(pDigits),
    threadTs,
    url: trimmed,
  };
}

/** Convenience predicate mirroring the frontend GitHub-issue detection helper. */
export function isSlackMessageUrl(url: string): boolean {
  return SLACK_MESSAGE_URL_RE.test(url.trim());
}
