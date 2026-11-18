/**
 * Where an arm picks a ticket out of a station or a zone. Arms stand anywhere round a box, so a ticket that is ready
 * to leave is not kept in one tray for all of them: it goes to a quay on the box's edge, in front of the arm that
 * will take it. One sees which way a ticket leaves before it does, and an arm only ever reaches the tile next to it:
 * its cup is on the ticket when it lifts it.
 *
 * Pure geometry and sorting, in tiles; the renderer paints.
 */
import { takesQuestions, wants } from './armRules';
import { DX, DY, type ArmSpec, type FactoryTicket, type MachineSpec } from './types';

/** How far inside the box's edge the centre of a quay is, and the side of the square it takes there. */
export const QUAY_IN = 0.26, QUAY_SIZE = 0.52;
/** How far from its base an arm's cup is over the middle of the next tile, and over the quay of a box. */
export const REACH_TILE = 1, REACH_QUAY = 0.5 + QUAY_IN;

/** How many tickets are shown in line at a quay. */
export const QUAY_ROOM = 3;

export const isBoxKind = (m: MachineSpec | null | undefined): boolean => !!m && (m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit');

/** The centre of the quay an arm picks from: on the tile behind it, against the edge it faces. */
export function quayOf(arm: ArmSpec): { x: number; y: number } {
  return { x: arm.x + 0.5 - DX[arm.dir] * REACH_QUAY, y: arm.y + 0.5 - DY[arm.dir] * REACH_QUAY };
}
/** The square of the quay itself, for the notch that is drawn in the box's edge. */
export function quayRect(arm: ArmSpec): { x: number; y: number; w: number; h: number } {
  const q = quayOf(arm);
  return { x: q.x - QUAY_SIZE / 2, y: q.y - QUAY_SIZE / 2, w: QUAY_SIZE, h: QUAY_SIZE };
}
/** Where the tickets waiting at a quay stand: the first on the quay, the next ones behind it, further into the box. */
export function quaySpot(arm: ArmSpec, rank: number): { x: number; y: number } {
  const q = quayOf(arm), back = Math.min(Math.max(0, rank), QUAY_ROOM - 1) * 0.34;
  return { x: q.x - DX[arm.dir] * back, y: q.y - DY[arm.dir] * back };
}
/**
 * How far from its base an arm's cup is when it picks and when it drops, in tiles: the middle of the tile for a belt
 * or the bare floor, just inside the edge for a station, a zone or an exit (its quay, when it picks).
 */
export function reachOf(src: MachineSpec | null, dst: MachineSpec | null): { from: number; to: number } {
  return { from: isBoxKind(src) ? REACH_QUAY : REACH_TILE, to: isBoxKind(dst) ? REACH_QUAY : REACH_TILE };
}

export interface Dispatch {
  /** Arm id → the tickets that will leave by it, the one that goes first first. */
  byArm: Map<string, FactoryTicket[]>;
  /** Ticket id → the arm whose quay it stands at. */
  quay: Map<string, string>;
  /** Tickets that are done and that no arm takes: they will not leave by themselves. */
  stuck: FactoryTicket[];
}
export interface DispatchHints {
  /** Ticket id → the arm it was given to last time: it stays there while that arm still takes it. */
  keep?: ReadonlyMap<string, string>;
  /** An arm that is carrying or coming back: between two arms that take the same ticket, the one at rest goes first. */
  busy?: (armId: string) => boolean;
}
/**
 * Which arm each ticket that is ready to leave a box will be taken by, as the engine will decide it: for a station,
 * what is done (and a question, by an arm that asks for questions); for a zone, what was released. Where several
 * arms take the same ticket, the engine gives it to whichever is free first: here, to the one with the shortest line.
 */
export function dispatch(box: MachineSpec, takers: readonly ArmSpec[], tickets: readonly FactoryTicket[], hints: DispatchHints = {}): Dispatch {
  const byArm = new Map<string, FactoryTicket[]>(), quay = new Map<string, string>(), stuck: FactoryTicket[] = [];
  const line = (a: ArmSpec) => (byArm.get(a.id)?.length ?? 0) + (hints.busy?.(a.id) ? 0.5 : 0);
  const give = (t: FactoryTicket, can: ArmSpec[]): boolean => {
    if (!can.length) return false;
    const kept = hints.keep?.get(t.ticketId);
    const arm = can.find((a) => a.id === kept) ?? can.reduce((best, a) => (line(a) < line(best) ? a : best));
    const list = byArm.get(arm.id); if (list) list.push(t); else byArm.set(arm.id, [t]);
    quay.set(t.ticketId, arm.id);
    return true;
  };
  for (const t of tickets) {
    const takes = (a: ArmSpec) => wants(a, takers, t.info, t.outcome);
    if (box.kind === 'station') {
      if (t.phase === 'out') { if (!give(t, takers.filter(takes))) stuck.push(t); }
      else if (t.phase === 'question') give(t, takers.filter((a) => takesQuestions(a) && takes(a)));
    } else if (box.kind === 'zone' && t.released) give(t, takers.filter(takes));
  }
  return { byArm, quay, stuck };
}

/** A point of a rectangle's edge, and the side it is on, as a unit vector along that side. */
export interface EdgePoint { x: number; y: number; ax: number; ay: number }
/**
 * Where something coming from a point crosses into a box: the point of the box nearest to it, and the side that
 * point is on. A point already inside counts as on the side it is nearest to.
 */
export function entryOf(box: { x: number; y: number; w: number; h: number }, from: { x: number; y: number }): EdgePoint {
  const x = Math.max(box.x, Math.min(box.x + box.w, from.x)), y = Math.max(box.y, Math.min(box.y + box.h, from.y));
  const d = [x - box.x, box.x + box.w - x, y - box.y, box.y + box.h - y], side = d.indexOf(Math.min(...d));
  return side < 2 ? { x: side === 0 ? box.x : box.x + box.w, y, ax: 0, ay: 1 } : { x, y: side === 2 ? box.y : box.y + box.h, ax: 1, ay: 0 };
}
