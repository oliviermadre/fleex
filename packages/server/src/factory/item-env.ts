/**
 * An item as a script station's commands see it: environment variables, the same for every source. What only a source
 * has comes from its own fields (`FactoryItemRow.fields`), each as `FLEEX_ITEM_FIELD_<KEY>`: a new source brings its
 * fields, and the station has nothing to learn. `FLEEX_ITEM_KEY` is the item's key in its source (a Gmail thread id).
 *
 * These values come from outside (a mail's subject is written by anyone): a command quotes them ("$FLEEX_ITEM_TITLE").
 * They are passed as exported variables, never spliced into the command.
 */
import type { FactoryItemRow } from './types.js';

const name = (key: string): string => key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function itemEnv(item: FactoryItemRow): Record<string, string> {
  const env: Record<string, string> = {
    FLEEX_ITEM_ID: item.id,
    FLEEX_ITEM_SOURCE: item.source,
    FLEEX_ITEM_KEY: item.sourceKey,
    FLEEX_ITEM_TITLE: item.title,
    FLEEX_ITEM_AUTHOR: item.author,
    FLEEX_ITEM_URL: item.url ?? '',
    FLEEX_ITEM_TAGS: item.tags.join(','),
    FLEEX_ITEM_MESSAGES: String(item.messages),
  };
  for (const [k, v] of Object.entries(item.fields ?? {})) {
    const n = name(k);
    if (n) env[`FLEEX_ITEM_FIELD_${n}`] = Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  }
  env['FLEEX_ITEM_JSON'] = JSON.stringify({ id: item.id, source: item.source, key: item.sourceKey, title: item.title, author: item.author, url: item.url, tags: item.tags, messages: item.messages, lastActivityAt: item.lastActivityAt, fields: item.fields ?? {} });
  return env;
}
