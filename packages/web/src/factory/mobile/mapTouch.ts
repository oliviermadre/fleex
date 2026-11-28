/**
 * What the map of the phone works out by itself, apart from the view (`FactoryView`), which is the page's: which
 * ticket a finger is on, and what is written over a machine seen from far.
 */
import { isBox } from '../scene';
import { needKind } from '../needs';
import type { FactoryLayout, FactoryTicket, MachineSpec } from '../types';

/** Where the view looks from, and its size on screen: what turns a place of the floor into a point of the screen. */
export interface Lens { cam: { x: number; y: number; z: number }; w: number; h: number }
export const toScreen = (v: Lens, wx: number, wy: number): { x: number; y: number } => ({ x: (wx - v.cam.x) * v.cam.z + v.w / 2, y: (wy - v.cam.y) * v.cam.z + v.h / 2 });

/**
 * The ticket a finger is on: the nearest one drawn within `radius` pixels of where it touched, whatever the zoom. A
 * finger covers far more than a pointer's tip, so the page's own reach (nine pixels) would miss.
 */
export function nearestTicket(places: Iterable<[string, { x: number; y: number }]>, v: Lens, at: { x: number; y: number }, radius: number): string | null {
  let best: string | null = null, d = radius;
  for (const [id, p] of places) {
    const s = toScreen(v, p.x, p.y), dd = Math.hypot(s.x - at.x, s.y - at.y);
    if (dd < d) { d = dd; best = id; }
  }
  return best;
}

/** Under that many pixels a tile, a machine is too small for its tickets to be told apart: it is read by its count. */
export const FAR_Z = 13;

export interface FarBadge { machineId: string; x: number; y: number; w: number; h: number; count: number; needs: boolean }
/**
 * What is written over each place of the floor seen from far: how many tickets it holds, and whether one of them waits
 * for someone. Only places that hold something, so an idle floor stays bare.
 */
export function farBadges(layout: FactoryLayout, tickets: readonly FactoryTicket[]): FarBadge[] {
  const inside = new Map<string, { count: number; needs: boolean }>();
  for (const t of tickets) {
    if (!t.machineId) continue;
    const at = inside.get(t.machineId) ?? { count: 0, needs: false };
    at.count++; at.needs ||= needKind(t) !== null;
    inside.set(t.machineId, at);
  }
  const out: FarBadge[] = [];
  for (const m of layout.machines) {
    const at = inside.get(m.id);
    if (!at || !isBox(m)) continue;
    out.push({ machineId: m.id, x: m.x, y: m.y, w: m.w, h: m.h, count: at.count, needs: at.needs || (m.kind === 'zone' && !!m.needsYou) });
  }
  return out;
}

/** Where a ticket in hand is shown once a place was touched: the middle of the machine it goes in, or of the tile. */
export function dropPoint(m: MachineSpec | null, wx: number, wy: number): { x: number; y: number } {
  return m && isBox(m) ? { x: m.x + m.w / 2, y: m.y + m.h / 2 } : { x: Math.floor(wx) + 0.5, y: Math.floor(wy) + 0.5 };
}

/** What putting the ticket in hand there does, as its line of the undo window says it. */
export function putLine(into: MachineSpec | null): string {
  if (!into) return 'put on the floor, where it will not move by itself';
  if (into.kind === 'belt') return 'put on a belt';
  if (into.kind === 'exit') return `leaves by ${into.name || 'the exit'}: it is done`;
  return `put in ${('name' in into && into.name) || (into.kind === 'zone' ? 'the zone' : into.kind === 'teleporter' ? 'the departure' : 'the station')}`;
}
