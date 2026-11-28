/**
 * The tickets of the floor as a list, for the phone: grouped by the machine each one stands in, the machines in the
 * order they stand on the floor (left to right, then top to bottom: the way a line usually runs), then what is on its
 * way between two machines, then what lies on the floor. Items are left out: the phone shows tickets only.
 */
import { DESK_COLOR, KIND_LOOK, kindOf } from '../machineArt';
import { needKind } from '../needs';
import type { FactoryTicket, MachineSpec, TicketPhase } from '../types';

export interface TicketGroup {
  key: string;
  /** The machine they stand in; null for what is on its way, or on the floor. */
  machine: MachineSpec | null;
  title: string;
  /** What kind of place it is, as the floor writes it over a machine's name. */
  word: string;
  /** The colour of that kind on the floor (a CSS colour); null: none of its own. */
  hue: string | null;
  tickets: FactoryTicket[];
  /** In a zone: those it still holds, which Release all lets out. */
  held: FactoryTicket[];
}

/** A gate's amber, the theme's own: what waits for a decision. */
const GATE_HUE = 'var(--theme-warning)';

/** The machines that hold tickets as a place does; belts, arms, bridges and teleporters only carry them. */
const isPlace = (m: MachineSpec): boolean => m.kind === 'station' || m.kind === 'zone' || m.kind === 'desk' || m.kind === 'intake' || m.kind === 'exit';

/** A place of the floor as a list names it: its name, the word of its kind, and that kind's colour on the floor (null: the theme's own). */
export function placeLook(m: MachineSpec): { title: string; word: string; hue: string | null } {
  if (m.kind === 'station') {
    const k = kindOf(m);
    if (k) return { title: m.name || 'Station', word: KIND_LOOK[k].word, hue: KIND_LOOK[k].hue };
    return m.exec === 'human_gate' ? { title: m.name || 'Gate', word: 'GATE', hue: GATE_HUE } : { title: m.name || 'Status', word: 'STATUS', hue: null };
  }
  if (m.kind === 'zone') return { title: m.name || 'Zone', word: m.inbound ? 'INBOUND' : 'ZONE', hue: null };
  if (m.kind === 'desk') return { title: m.name || 'Desk', word: 'DESK', hue: DESK_COLOR };
  if (m.kind === 'intake') return { title: m.name || 'Intake', word: 'INTAKE', hue: DESK_COLOR };
  return { title: m.name || 'Exit', word: 'EXIT', hue: null };
}

export function groupTickets(tickets: readonly FactoryTicket[], machines: readonly MachineSpec[]): TicketGroup[] {
  const byId = new Map(machines.map((m) => [m.id, m])), inside = new Map<string, FactoryTicket[]>(), way: FactoryTicket[] = [], loose: FactoryTicket[] = [];
  for (const t of tickets) {
    if (t.item) continue;
    const m = t.machineId ? byId.get(t.machineId) : undefined;
    if (!m || t.phase === 'loose') loose.push(t);
    else if (!isPlace(m)) way.push(t);
    else { const a = inside.get(m.id); if (a) a.push(t); else inside.set(m.id, [t]); }
  }
  const places = machines.filter((m) => inside.has(m.id)).sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2) || a.y - b.y || a.id.localeCompare(b.id));
  const out: TicketGroup[] = places.map((m) => {
    const here = inside.get(m.id)!;
    return { key: m.id, machine: m, ...placeLook(m), tickets: here, held: m.kind === 'zone' ? here.filter((t) => t.phase === 'zone' && !t.released) : [] };
  });
  if (way.length) out.push({ key: ':way', machine: null, title: 'On its way', word: 'BELTS AND ARMS', hue: null, tickets: way, held: [] });
  if (loose.length) out.push({ key: ':floor', machine: null, title: 'On the floor', word: 'NO MACHINE', hue: null, tickets: loose, held: [] });
  return out;
}

/** Does a ticket answer a search: its number, a word of its title, its type, one of its tags. */
export function matches(t: FactoryTicket, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  const i = t.info;
  if (!i) return false;
  return String(i.displayId).includes(q) || i.title.toLowerCase().includes(q) || i.type.toLowerCase().includes(q) || i.tags.some((g) => g.toLowerCase().includes(q));
}

const SHORT: Record<TicketPhase, string> = {
  review: 'decision', question: 'question', failed: 'run failed', aside: 'set aside', running: 'running', wait: 'waiting to start', out: 'done',
  zone: 'held', loose: 'on the floor', belt: 'on its way', arm: 'on its way', port: 'on its way',
};
/** Where a ticket is at, in a word or two: what a line of the list ends on; `needs` when it waits for someone. */
export function shortState(t: FactoryTicket, m: MachineSpec | null | undefined): { text: string; needs: boolean } {
  const zone = t.phase === 'zone' && m?.kind === 'zone' ? m : null;
  const needs = needKind(t) !== null || !!zone?.needsYou;
  return { text: zone ? (zone.needsYou ? 'for you' : t.released ? 'released' : 'held') : SHORT[t.phase], needs };
}
