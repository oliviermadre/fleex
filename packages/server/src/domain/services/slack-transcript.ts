/** The subset of a Slack message Fleex reads. */
export interface SlackMessage {
  readonly ts: string;
  readonly text?: string;
  readonly user?: string;
  readonly bot_id?: string;
  readonly username?: string;
  readonly subtype?: string;
  readonly reply_count?: number;
  readonly files?: readonly { readonly name?: string; readonly title?: string }[];
}

/** Housekeeping messages that say nothing about the discussion. */
const NOISE_SUBTYPES = new Set(['channel_join', 'channel_leave', 'group_join', 'group_leave', 'channel_topic', 'channel_purpose', 'channel_name']);

const USER_MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

/** Every user id needed to render the conversation: its authors and whoever they mention. */
export function collectUserIds(messages: readonly SlackMessage[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.user) ids.add(message.user);
    for (const match of (message.text ?? '').matchAll(USER_MENTION_RE)) ids.add(match[1]!);
  }
  return [...ids];
}

/**
 * Render a Slack conversation as plain text — one `[time] Name: text` line per
 * message. Slack's wire format (`<@U123>`, `<url|label>`, `&amp;`) is turned into
 * what a person would read, because this text is what gets summarised: an
 * unresolved `<@U042>` would surface in the ticket as a meaningless id.
 */
export function formatSlackTranscript(messages: readonly SlackMessage[], userNames: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.subtype && NOISE_SUBTYPES.has(message.subtype)) continue;
    const files = (message.files ?? []).map((f) => `[file: ${f.name ?? f.title ?? 'untitled'}]`).join(' ');
    const body = [renderText(message.text ?? '', userNames), files].filter(Boolean).join(' ').trim();
    if (!body) continue;
    const author = (message.user && (userNames.get(message.user) ?? message.user)) || message.username || 'unknown';
    lines.push(`[${formatTs(message.ts)}] ${author}: ${body}`);
  }
  return lines.join('\n');
}

function renderText(text: string, userNames: ReadonlyMap<string, string>): string {
  return text
    .replace(USER_MENTION_RE, (_, id: string) => `@${userNames.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<#([A-Z0-9]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]*)>/g, '$1')
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    // Entities last: Slack escapes exactly these three, and `&lt;` must not be
    // mistaken for markup by the rules above.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Slack `ts` ("1700000000.000100") → "2023-11-14 22:13", UTC so it is the same for everyone. */
function formatTs(ts: string): string {
  const date = new Date(Number(ts.split('.')[0]) * 1000);
  return Number.isNaN(date.getTime()) ? ts : date.toISOString().slice(0, 16).replace('T', ' ');
}
