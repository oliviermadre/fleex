/**
 * Selecting several tickets at once, out of build mode: a frame is dragged over the floor and takes the tickets that
 * are in it (machines are not selected there: they are in build mode). And what a group of tickets can be asked to do
 * together, for the command card.
 */
import { canSetAside, type FactoryTicket, type MachineSpec, type Selection } from './types';

export interface Frame { x0: number; y0: number; x1: number; y1: number }

/** The tickets whose place on the floor is inside a frame, whichever way it was dragged; in the order given. */
export function ticketsIn(places: Iterable<[string, { x: number; y: number }]>, f: Frame): string[] {
  const xa = Math.min(f.x0, f.x1), xb = Math.max(f.x0, f.x1), ya = Math.min(f.y0, f.y1), yb = Math.max(f.y0, f.y1), out: string[] = [];
  for (const [id, p] of places) if (p.x >= xa && p.x <= xb && p.y >= ya && p.y <= yb) out.push(id);
  return out;
}

/* a selection as the ids it holds, and back: one thing is not a group of one */
export const machineIds = (s: Selection): string[] => (s && 'machines' in s ? s.machines : s && 'machine' in s ? [s.machine] : []);
export const ticketIds = (s: Selection): string[] => (s && 'tickets' in s ? s.tickets : s && 'ticket' in s ? [s.ticket] : []);
export const machinesSel = (ids: string[]): Selection => (ids.length > 1 ? { machines: ids } : ids.length === 1 ? { machine: ids[0]! } : null);
export const ticketsSel = (ids: string[]): Selection => (ids.length > 1 ? { tickets: ids } : ids.length === 1 ? { ticket: ids[0]! } : null);

/** Whether two selections hold the same things, in the same order. */
export const sameSelection = (a: Selection, b: Selection): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What a selection becomes when something is picked. Without Shift the pick replaces it. With Shift it adds to it:
 * what was not there joins, in the order picked; and one thing clicked that was already there is taken out
 * (`toggles`, for a click: a frame only ever adds).
 */
export function addTo(current: readonly string[], picked: readonly string[], shift: boolean, toggles = false): string[] {
  if (!shift) return [...picked];
  if (toggles && picked.length === 1 && current.includes(picked[0]!)) return current.filter((id) => id !== picked[0]);
  const out = [...current];
  for (const id of picked) if (!out.includes(id)) out.push(id);
  return out;
}

/** What a group of tickets can do together: how many each command would act on. */
export interface TicketGroup {
  count: number;
  /** Waiting in a zone, not yet released. */
  release: number;
  /** Set aside by someone, or after a failed run: their station can run on them again. */
  retry: number;
  /** In the hands of a station, which can be asked to let go of them. */
  aside: number;
  /** True when every one of them (that Fleex knows) is a favourite: the command then removes the star. */
  starred: boolean;
}
export function groupOf(tickets: readonly FactoryTicket[], machines: readonly MachineSpec[]): TicketGroup {
  const byId = new Map(machines.map((m) => [m.id, m]));
  const known = tickets.filter((t) => t.info);
  return {
    count: tickets.length,
    release: tickets.filter((t) => t.phase === 'zone' && !t.released).length,
    retry: tickets.filter((t) => t.phase === 'failed' || t.phase === 'aside').length,
    aside: tickets.filter((t) => canSetAside(t, t.machineId ? byId.get(t.machineId) : null)).length,
    starred: known.length > 0 && known.every((t) => t.info!.favorite),
  };
}
