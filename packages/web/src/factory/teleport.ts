/**
 * Teleporters: a jump across the floor. A departure takes one ticket and sends it to the arrival it is set to; an
 * arrival holds one ticket, takes nothing from the floor, and an arm takes the ticket out. The engine does the
 * sending; this file says what the page shows of it: which colour a teleporter is, what state it is in, and the line
 * under its name. Pure: the renderer and the popup both read from it.
 */
import { wants } from './armRules';
import type { ArmSpec, FactoryTicket, MachineSpec, TeleporterSpec } from './types';

/** The colour of a teleporter that was given none, and leads to none that has one. */
export const PORT_COLOR = '#22d3ee';
const isColour = (c: string | undefined): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c);
type Find = (id: string) => MachineSpec | null | undefined;

export const isPort = (m: MachineSpec | null | undefined): m is TeleporterSpec => !!m && m.kind === 'teleporter';
export const isDeparture = (m: MachineSpec | null | undefined): m is TeleporterSpec => isPort(m) && m.role === 'departure';
export const isArrival = (m: MachineSpec | null | undefined): m is TeleporterSpec => isPort(m) && m.role === 'arrival';
export const portName = (m: TeleporterSpec): string => m.name || (m.role === 'arrival' ? 'Arrival' : 'Departure');

/** The arrival a departure leads to, when it has one that is still on the floor. */
export function arrivalOf(m: TeleporterSpec, find: Find): TeleporterSpec | null {
  const a = m.role === 'departure' && m.to ? find(m.to) : null;
  return isArrival(a) ? a : null;
}
/** The departures that lead to an arrival. */
export const departuresOf = (arrival: TeleporterSpec, machines: readonly MachineSpec[]): TeleporterSpec[] => machines.filter((m): m is TeleporterSpec => isDeparture(m) && m.to === arrival.id);
export const arrivalsOn = (machines: readonly MachineSpec[]): TeleporterSpec[] => machines.filter(isArrival);

/**
 * The colour of a teleporter: the one it was given; without one, a departure takes the colour of the arrival it
 * leads to, so the two read as a pair.
 */
export function portColor(m: TeleporterSpec, find: Find): string {
  if (isColour(m.color)) return m.color;
  const a = arrivalOf(m, find);
  return a && isColour(a.color) ? a.color : PORT_COLOR;
}
/** The colour a teleporter has while none is picked for it: what "Automatic" means in its popup. */
export const portOwnColor = (m: TeleporterSpec, find: Find): string => portColor({ ...m, color: undefined }, find);

/**
 * What a teleporter is doing. `waiting`: a departure keeps its ticket because the arrival holds one. `no-destination`:
 * a departure that leads nowhere, it keeps whatever it is given. `no-arm`: an arrival holds a ticket no arm takes, so
 * nothing more will come to it.
 */
export type PortState = 'ok' | 'waiting' | 'no-destination' | 'no-arm';
export function portState(m: TeleporterSpec, at: { arrival: TeleporterSpec | null; arrivalHolds: boolean; holds: FactoryTicket | null; takers: readonly ArmSpec[] }): PortState {
  if (m.role === 'departure') return !at.arrival ? 'no-destination' : at.holds && at.arrivalHolds ? 'waiting' : 'ok';
  const t = at.holds;
  return t && !at.takers.some((a) => wants(a, at.takers, t.info, t.outcome)) ? 'no-arm' : 'ok';
}
export const portBad = (s: PortState): boolean => s === 'no-destination' || s === 'no-arm';

/** The line under a teleporter's name: where it leads, how many lead to it, or what keeps it from working. */
export function portLine(m: TeleporterSpec, state: PortState, arrival: TeleporterSpec | null, departures: number): string {
  if (state === 'no-destination') return 'no destination';
  if (state === 'no-arm') return 'no arm takes from it';
  if (state === 'waiting') return 'waits · arrival busy';
  if (m.role === 'departure') return `→ ${arrival ? portName(arrival) : ''}`;
  return departures === 0 ? 'no departure leads here' : `← ${departures} departure${departures === 1 ? '' : 's'}`;
}

/**
 * Whether a ticket can be dropped by hand on a teleporter, and what the page says while it is held over it. As for
 * an arm or a belt: a departure takes one ticket, an arrival takes none.
 */
export function portDrop(m: TeleporterSpec, holds: boolean, arrival: TeleporterSpec | null): { ok: boolean; text: string } {
  if (m.role === 'arrival') return { ok: false, text: 'Nothing enters an arrival: tickets come to it from its departures' };
  if (holds) return { ok: false, text: `${portName(m)} already holds a ticket` };
  return { ok: true, text: arrival ? `Send to ${portName(arrival)}` : `${portName(m)} leads nowhere: it will stay there` };
}

/**
 * Pasted machines get new ids: a departure pasted with its arrival leads to the copy of that arrival, one pasted
 * alone still leads to the arrival it led to.
 */
export function relink<T extends MachineSpec>(copies: T[], ids: ReadonlyMap<string, string>): T[] {
  return copies.map((m) => (isDeparture(m) && m.to && ids.has(m.to) ? { ...m, to: ids.get(m.to) } : m));
}
