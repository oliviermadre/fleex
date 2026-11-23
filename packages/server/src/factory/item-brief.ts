import { htmlToText, looksLikeHtml } from '@fleex/shared';
import type { FactoryItemRow, FactoryRunRow, ItemBody } from './types.js';
import { SOURCE_FIELDS } from './item-sources.js';

const SOURCE: Record<string, string> = { slack: 'Slack', gmail: 'Gmail', github: 'GitHub', manual: 'made by hand' };
/** How many earlier visits a brief recalls, and how much of each answer. */
const EARLIER = 3, REPLY_MAX = 4000;
/** How much of the whole message a brief gives. */
const BODY_MAX = 20_000;

/**
 * An item in words: what a station that runs on it is given as its brief, in place of a ticket. Generic: it says what
 * every item has (where it came from, from whom, its title, how many messages, its link, its tags and the lines it came
 * with), whatever its source. A connector will later add what only its source knows (the whole conversation, read
 * again at run time); until then the excerpt is all there is, and the brief says so.
 *
 * What stations already said about it comes last: an item has no thread, so a station that runs on it again (after
 * a question, or a second station down the line) learns what was said before from here.
 */
export function itemBrief(item: FactoryItemRow, earlier: readonly FactoryRunRow[] = [], body: ItemBody | null = null): string {
  /* the whole message when it was kept (its text; its HTML part's, for a mail that had no text), else its first lines */
  const whole = body?.text?.trim() || (body?.html ? htmlToText(body.html) : '');
  const shown = whole || (looksLikeHtml(item.excerpt) ? htmlToText(item.excerpt) : item.excerpt);
  const lines = [
    `An item that came in to the Factory${item.source === 'manual' ? ', made by hand' : ` from ${SOURCE[item.source] ?? item.source}`}. It is not a ticket.`,
    '',
    `- **Title**: ${item.title}`,
    item.author ? `- **From**: ${item.author}` : null,
    `- **Messages**: ${item.messages}, the last one at ${item.lastActivityAt}`,
    item.url ? `- **Link**: ${item.url}` : null,
    item.tags.length ? `- **Tags**: ${item.tags.join(', ')}` : null,
    ...details(item),
    '',
    '## What came with it',
    '',
    shown ? (shown.length > BODY_MAX ? `${shown.slice(0, BODY_MAX)}…` : shown) : '_Nothing but its title._',
    '',
    whole ? '_This is its latest message, whole; the earlier ones of the conversation are in its source._' : '_This is all the Factory keeps of it: the rest is in its source._',
  ].filter((l): l is string => l !== null);
  const said = earlier.filter((r) => r.reply || r.outcome).slice(-EARLIER);
  if (said.length) {
    lines.push('', '## What stations said about it before');
    for (const r of said) {
      lines.push('', `### ${r.machineName}${r.outcome ? ` (left as "${r.outcome}")` : r.status === 'question' ? ' (asked a question)' : ''}`);
      if (r.reply) lines.push('', r.reply.length > REPLY_MAX ? `${r.reply.slice(0, REPLY_MAX)}…` : r.reply);
    }
  }
  return lines.join('\n');
}

/** What its source says of it beyond that, by the names its source's fields have (a field not in the list keeps its key). */
function details(item: FactoryItemRow): string[] {
  const label = new Map(SOURCE_FIELDS[item.source].map((f) => [f.key, f.label]));
  return Object.entries(item.fields ?? {}).map(([k, v]) => `- **${label.get(k) ?? k}**: ${Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}`);
}

/** The prompt's first line for a run on an item. */
export const itemHeading = (item: FactoryItemRow): string => `Factory item${item.source === 'manual' ? '' : ` from ${SOURCE[item.source] ?? item.source}`}`;
