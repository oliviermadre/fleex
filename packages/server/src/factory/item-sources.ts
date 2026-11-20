/**
 * What each source says about an item beyond what every item has (author, title, text): its own fields, filled by its
 * connector (`ItemInput.fields`), and filtered on by an intake's rules of that source. The page mirrors this list
 * (`packages/web/src/factory/itemSources.ts`).
 *
 * The common part (`COMMON_FIELDS`) is generic; this catalogue is the only thing that differs from one source to the
 * next until the connectors exist. A source with no field of its own (an item made by hand) has only the common part.
 */
import type { ItemSource } from './types.js';

/** `text` is matched by "contains", `list` holds several values (any of them matches), `choice` one of `choices`, `bool` yes or no. */
export type FieldKind = 'text' | 'list' | 'choice' | 'bool';
export interface SourceField { key: string; label: string; kind: FieldKind; choices?: readonly string[]; hint?: string }

/** What every item has, whatever its source. */
export const COMMON_FIELDS: readonly SourceField[] = [
  { key: 'author', label: 'From', kind: 'text' },
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'text', label: 'Title or text', kind: 'text' },
];

export const SOURCE_FIELDS: Record<ItemSource, readonly SourceField[]> = {
  slack: [
    { key: 'channel', label: 'Channel', kind: 'text', hint: '#ops, or a person\'s name for a direct message' },
    { key: 'kind', label: 'Kind', kind: 'choice', choices: ['dm', 'mention', 'thread', 'channel'], hint: 'a direct message, a mention of you, a thread you are in, a channel message' },
    { key: 'bot', label: 'From a bot', kind: 'bool' },
  ],
  gmail: [
    { key: 'to', label: 'To', kind: 'text' },
    { key: 'cc', label: 'Cc', kind: 'text' },
    { key: 'labels', label: 'Labels', kind: 'list', hint: 'INBOX, IMPORTANT, CATEGORY_PROMOTIONS…' },
    { key: 'attachment', label: 'Has an attachment', kind: 'bool' },
  ],
  github: [
    { key: 'repo', label: 'Repository', kind: 'text', hint: 'org/name' },
    { key: 'reason', label: 'Why', kind: 'choice', choices: ['review_requested', 'mention', 'assign', 'author', 'comment', 'ci'], hint: 'why it is for you, as GitHub says it' },
    { key: 'draft', label: 'A draft', kind: 'bool' },
  ],
  manual: [],
};

export const fieldsOf = (source: ItemSource): readonly SourceField[] => [...COMMON_FIELDS, ...SOURCE_FIELDS[source]];
