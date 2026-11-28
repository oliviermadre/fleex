/**
 * Where a ticket taken in hand may be put: on a station, in a zone, on a belt (it then follows it), in an exit (it
 * ships), in a departure that is free, or on the bare floor, where it will not move by itself. Not on an arm, a desk,
 * an intake or an arrival. The page asks while a ticket is dragged; the phone asks when the floor is touched with a
 * ticket in hand (`mobile/MobileFactoryMap.tsx`).
 */
import { arrivalOf, portDrop } from './teleport';
import type { FactoryTicket, MachineSpec, Target } from './types';

const ARROW = ['→', '↓', '←', '↑'];

/** What the floor says of itself to whoever asks: the view does (`FactoryView`). */
export interface FloorReader {
  at(x: number, y: number): MachineSpec | null;
  machine(id: string | null): MachineSpec | null;
  leadsTo(m: MachineSpec | null, dir?: number): MachineSpec | null;
}
/** `can`: it may be put there; `ok`: and it will go on from there by itself (the bare floor may, and will not). */
export interface Drop { target: Target; ok: boolean; can: boolean; text: string }

export function dropAt(v: FloorReader, tickets: readonly FactoryTicket[], wx: number, wy: number): Drop {
  const tx = Math.floor(wx), ty = Math.floor(wy), m = v.at(tx, ty);
  if (!m) return { target: { x: tx, y: ty }, ok: false, can: true, text: 'On the floor: it will not move by itself' };
  if (m.kind === 'arm' || m.kind === 'label') return { target: {}, ok: false, can: false, text: 'Not on an arm' };
  if (m.kind === 'desk') return { target: {}, ok: false, can: false, text: 'Not on a desk: tickets are born there' };
  if (m.kind === 'intake') return { target: {}, ok: false, can: false, text: 'Not in an intake: items come to it from their source' };
  if (m.kind === 'teleporter') {
    /* as for an arm: a departure takes one ticket, an arrival none */
    const held = tickets.some((t) => t.machineId === m.id), drop = portDrop(m, held, arrivalOf(m, (id) => v.machine(id)));
    return { target: drop.ok ? { machineId: m.id } : {}, ok: drop.ok, can: drop.ok, text: drop.text };
  }
  const dest = m.kind === 'belt' ? v.leadsTo(m) : null;
  return { target: { machineId: m.id }, ok: true, can: true, text: m.kind === 'belt' ? `Belt ${ARROW[m.dir]}${dest ? ` towards ${dest.name ?? dest.kind}` : ': leads nowhere'}` : m.kind === 'exit' ? 'Ship: sets it to done' : `Drop in ${m.name ?? m.kind}` };
}
