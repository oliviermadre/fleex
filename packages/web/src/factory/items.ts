/**
 * Items: conversations that came in from a source (Slack, Gmail, GitHub, or made by hand) and are not tickets. On the
 * floor an item is an object in relief, as a ticket is (`ticketToken.ts`), drawn from its source's mark instead of a
 * type's icon: its type is `src:<source>` (the server gives it so), which is all the floor needs to draw it.
 *
 * The marks are drawn for the floor, in strokes on a 24-unit box like Fleex's icons: they recall each source (a hash of
 * four bars and four dots, an envelope with its fold, a branch with its commits, a sheet), they are not the sources'
 * own logos.
 */
import type { Part } from './ticketToken';
import type { FactoryTicket } from './types';

export type ItemSource = 'slack' | 'gmail' | 'github' | 'manual';
export const ITEM_SOURCES: readonly ItemSource[] = ['slack', 'gmail', 'github', 'manual'];
export const SOURCE_LABEL: Record<ItemSource, string> = { slack: 'Slack', gmail: 'Gmail', github: 'GitHub', manual: 'By hand' };
/** The colour of each source's items, intakes and marks: paint, on any theme (the mock-up's, `docs/factory/intake.html`). */
export const SOURCE_COLORS: Record<ItemSource, string> = { slack: '#e879f9', gmail: '#fda4af', github: '#d4d4d8', manual: '#93c5fd' };

export const SOURCE_PARTS: Record<ItemSource, Part[]> = {
  slack: [
    { kind: 'path', d: 'M9.5 4v7' }, { kind: 'path', d: 'M14.5 13v7' }, { kind: 'path', d: 'M4 14.5h7' }, { kind: 'path', d: 'M13 9.5h7' },
    { kind: 'circle', cx: 14.5, cy: 5.5, r: 1.1 }, { kind: 'circle', cx: 5.5, cy: 9.5, r: 1.1 }, { kind: 'circle', cx: 18.5, cy: 14.5, r: 1.1 }, { kind: 'circle', cx: 9.5, cy: 18.5, r: 1.1 },
  ],
  gmail: [{ kind: 'rect', x: 3.5, y: 5.5, w: 17, h: 13, rx: 2.2 }, { kind: 'path', d: 'M4.5 7l7.5 6 7.5-6' }],
  github: [
    { kind: 'circle', cx: 7, cy: 6, r: 2.2 }, { kind: 'circle', cx: 7, cy: 18, r: 2.2 }, { kind: 'circle', cx: 17, cy: 8, r: 2.2 },
    { kind: 'path', d: 'M7 8.5v7' }, { kind: 'path', d: 'M17 10.5c0 3.5-3 4.5-8 5.5' },
  ],
  manual: [{ kind: 'rect', x: 5.5, y: 3.5, w: 13, h: 17, rx: 2 }, { kind: 'path', d: 'M9 9h6M9 12.5h6M9 16h3.5' }],
};

const PREFIX = 'src:';
/** The source an item's type stands for, or null when it is a ticket's type. */
export function sourceOfType(type: string): ItemSource | null {
  if (!type.startsWith(PREFIX)) return null;
  const s = type.slice(PREFIX.length) as ItemSource;
  return ITEM_SOURCES.includes(s) ? s : null;
}
/** The type a token of that source is drawn from. */
export const sourceType = (s: ItemSource): string => `${PREFIX}${s}`;
export const isItem = (t: Pick<FactoryTicket, 'item'> | null | undefined): boolean => !!t?.item;
/** Colours of tokens by type, for the sources: merged into the floor's colours by type. */
export const SOURCE_TYPE_COLORS: Record<string, string> = Object.fromEntries(ITEM_SOURCES.map((s) => [sourceType(s), SOURCE_COLORS[s]]));

/** How a token is named in a line: `#12` for a ticket, its source for an item (an item has no number). */
export function refOf(info: { displayId: number; type: string } | null | undefined): string {
  if (!info) return '#?';
  const s = sourceOfType(info.type);
  return s ? SOURCE_LABEL[s] : `#${info.displayId}`;
}
