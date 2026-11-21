/**
 * What each source says about an item beyond what every item has, as the server lists it
 * (`packages/server/src/factory/item-sources.ts`): the fields an intake's rules of that source can filter on, and that
 * an item made by hand can be given. The common part is every source's; the rest is the only thing that differs from
 * one source to another until the connectors exist.
 */
import type { ItemSource } from './items';

export type FieldKind = 'text' | 'list' | 'choice' | 'bool';
export interface SourceField { key: string; label: string; kind: FieldKind; choices?: readonly string[]; hint?: string }

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
/** The operators that make sense on a kind of field: contains for text, is or is not for the rest. */
export const opsFor = (kind: FieldKind): readonly ('contains' | 'is' | 'is_not')[] => (kind === 'text' || kind === 'list' ? ['contains', 'is', 'is_not'] : ['is', 'is_not']);
