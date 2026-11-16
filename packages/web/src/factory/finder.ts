/**
 * Finding tickets on the floor. A filter never hides a ticket: the ones it
 * leaves out are drawn faded, the ones it keeps stand out and carry their name.
 */
import type { FactoryTicket } from './types';

/** Where a ticket stands, in the few words a person filters on: several phases of the engine make one state. */
export type TicketState = 'moving' | 'floor' | 'queue' | 'running' | 'human' | 'done' | 'zone';
export const STATE_LABEL: Record<TicketState, string> = {
  moving: 'Travelling', floor: 'On the floor', queue: 'Queueing', running: 'Running', human: 'Waiting for you', done: 'Done here', zone: 'In a zone',
};
export const STATES = Object.keys(STATE_LABEL) as TicketState[];
export function stateOf(t: FactoryTicket): TicketState {
  switch (t.phase) {
    case 'belt': case 'arm': return 'moving';
    case 'loose': return 'floor';
    case 'wait': return 'queue';
    case 'running': return 'running';
    case 'review': case 'question': case 'failed': return 'human';
    case 'out': return 'done';
    default: return 'zone';
  }
}

/** The complexity scale, lowest first: what a range is read against. A ticket that is not estimated is on no scale. */
const SCALE = ['0', '0.5', '1', '2', '3', '5', '8', '13', '21', '34', '55', 'inf'];

export interface Finder {
  /** Free text: a ticket number (with or without #), words of the title, a tag. */
  q: string;
  /** Board ids. Empty means every board. */
  boards: string[];
  /** Ticket types; `none` stands for a ticket with no type. Empty means all. */
  types: string[];
  /** Priorities. Empty means all. */
  priorities: string[];
  /** Ticket statuses (todo, doing…). Empty means all. */
  statuses: string[];
  /** Ids of the stations and zones to look in. Empty means anywhere. */
  machines: string[];
  /** Where the ticket stands. Empty means any state. */
  states: TicketState[];
  /** Complexity, from and to (both included); an empty bound is open. `unestimated` also keeps tickets with no estimate. */
  complexityMin: string; complexityMax: string; unestimated: boolean;
  favorite: boolean;
  /** Only tickets that wait for a human. */
  waiting: boolean;
  /** Only tickets marked as blocked. */
  blocked: boolean;
}
export const NO_FINDER: Finder = {
  q: '', boards: [], types: [], priorities: [], statuses: [], machines: [], states: [], complexityMin: '', complexityMax: '', unestimated: false,
  favorite: false, waiting: false, blocked: false,
};

const byComplexity = (f: Finder): boolean => !!f.complexityMin || !!f.complexityMax || f.unestimated;
export const finderActive = (f: Finder): boolean => !!f.q.trim() || f.boards.length > 0 || f.types.length > 0 || f.priorities.length > 0
  || f.statuses.length > 0 || f.machines.length > 0 || f.states.length > 0 || byComplexity(f) || f.favorite || f.waiting || f.blocked;
/** How many criteria are set, the search aside: shown on the button that opens them. */
export const finderCount = (f: Finder): number => [f.boards.length, f.types.length, f.priorities.length, f.statuses.length, f.machines.length, f.states.length]
  .filter((n) => n > 0).length + Number(byComplexity(f)) + Number(f.favorite) + Number(f.waiting) + Number(f.blocked);

function complexityMatches(c: string | null, f: Finder): boolean {
  if (c === null) return f.unestimated;
  const at = SCALE.indexOf(c), min = f.complexityMin ? SCALE.indexOf(f.complexityMin) : -1, max = f.complexityMax ? SCALE.indexOf(f.complexityMax) : SCALE.length;
  /* "not estimated" alone asks for those only; with a bound, it adds them to the range */
  if (!f.complexityMin && !f.complexityMax) return false;
  return at >= 0 && at >= min && at <= max;
}

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
  if (f.statuses.length && !f.statuses.includes(info.status)) return false;
  if (f.machines.length && !(t.machineId && f.machines.includes(t.machineId))) return false;
  if (f.states.length && !f.states.includes(stateOf(t))) return false;
  if (byComplexity(f) && !complexityMatches(info.complexity, f)) return false;
  if (f.favorite && !info.favorite) return false;
  if (f.waiting && !waitsForHuman(t)) return false;
  if (f.blocked && !info.blocked) return false;
  return true;
}

/** The tickets a filter keeps, favourites first, then by number. Null when no filter is on. */
export function find(tickets: FactoryTicket[], f: Finder, waitsForHuman: (t: FactoryTicket) => boolean): FactoryTicket[] | null {
  if (!finderActive(f)) return null;
  return tickets.filter((t) => matches(t, f, waitsForHuman))
    .sort((a, b) => Number(b.info?.favorite ?? false) - Number(a.info?.favorite ?? false) || (a.info?.displayId ?? 0) - (b.info?.displayId ?? 0));
}
