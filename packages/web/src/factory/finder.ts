/**
 * Finding tickets on the floor. A filter never hides a ticket: the ones it
 * leaves out are drawn faded, the ones it keeps stand out and carry their name.
 */
import type { FactoryTicket } from './types';

export interface Finder {
  /** Free text: a ticket number (with or without #), words of the title, a tag. */
  q: string;
  /** Board ids. Empty means every board. */
  boards: string[];
  /** Ticket types; `none` stands for a ticket with no type. Empty means all. */
  types: string[];
  /** Priorities. Empty means all. */
  priorities: string[];
  favorite: boolean;
  /** Only tickets that wait for a human. */
  waiting: boolean;
}
export const NO_FINDER: Finder = { q: '', boards: [], types: [], priorities: [], favorite: false, waiting: false };

export const finderActive = (f: Finder): boolean => !!f.q.trim() || f.boards.length > 0 || f.types.length > 0 || f.priorities.length > 0 || f.favorite || f.waiting;

/** Every word typed must be found: in the number, the title or a tag. */
function textMatches(t: FactoryTicket, q: string): boolean {
  const info = t.info;
  if (!info) return false;
  const hay = `#${info.displayId} ${info.title} ${info.tags.join(' ')}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => (/^#?\d+$/.test(w) ? String(info.displayId).includes(w.replace('#', '')) : hay.includes(w)));
}

export function matches(t: FactoryTicket, f: Finder, waitsForHuman: (t: FactoryTicket) => boolean): boolean {
  const info = t.info;
  if (!info) return !finderActive(f);
  if (f.q.trim() && !textMatches(t, f.q)) return false;
  if (f.boards.length && !f.boards.includes(info.boardId)) return false;
  if (f.types.length && !f.types.includes(info.type || 'none')) return false;
  if (f.priorities.length && !f.priorities.includes(info.priority || 'none')) return false;
  if (f.favorite && !info.favorite) return false;
  if (f.waiting && !waitsForHuman(t)) return false;
  return true;
}

/** The tickets a filter keeps, favourites first, then by number. Null when no filter is on. */
export function find(tickets: FactoryTicket[], f: Finder, waitsForHuman: (t: FactoryTicket) => boolean): FactoryTicket[] | null {
  if (!finderActive(f)) return null;
  return tickets.filter((t) => matches(t, f, waitsForHuman))
    .sort((a, b) => Number(b.info?.favorite ?? false) - Number(a.info?.favorite ?? false) || (a.info?.displayId ?? 0) - (b.info?.displayId ?? 0));
}
