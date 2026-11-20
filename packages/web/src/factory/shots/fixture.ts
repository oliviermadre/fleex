/**
 * A made-up floor that has one of everything the renderer draws: each kind of station in each of its states, zones
 * that hold and release, belts that bend, run fast and cross, a gantry and a toll, plain, conditional and coloured
 * arms, a pair of teleporters, an exit, a label, and tickets in every phase. It is what `shots.ts` paints, so that
 * a change to the renderer can be compared, picture against picture, with what it drew before.
 *
 * Not a working factory: the tickets are placed, not routed. Settings shows it too, as the preview of each skin.
 */
import type { LensLayer } from '../lens';
import type { ViewState } from '../renderer';
import type { FactoryLayout, FactoryTicket, MachineSpec, TicketPhase } from '../types';

const M: MachineSpec[] = [
  { id: 'z_in', kind: 'zone', x: 0, y: 0, w: 4, h: 3, name: 'Inbound', release: 'manual', inbound: true },
  { id: 'a1', kind: 'arm', x: 4, y: 1, w: 1, h: 1, dir: 0 },
  { id: 'b1', kind: 'belt', x: 5, y: 1, w: 1, h: 1, dir: 0 },
  { id: 'b2', kind: 'belt', x: 6, y: 1, w: 1, h: 1, dir: 0, fast: true },
  { id: 'g1', kind: 'belt', x: 7, y: 1, w: 1, h: 1, dir: 0, set: [{ field: 'status', value: 'reviewing' }, { field: 'tag', op: 'inc', value: 'passes' }] },
  { id: 'b3', kind: 'belt', x: 8, y: 1, w: 1, h: 1, dir: 0 },
  { id: 'a2', kind: 'arm', x: 9, y: 1, w: 1, h: 1, dir: 0 },
  { id: 'st_agent', kind: 'station', x: 10, y: 0, w: 5, h: 4, name: 'Build', exec: 'agent', ref: 'builder', model: 'claude-sonnet-4-5', outcomes: ['ok', 'ko'], cap: 2 },
  { id: 'a3', kind: 'arm', x: 15, y: 1, w: 1, h: 1, dir: 0 },
  { id: 'a4', kind: 'arm', x: 15, y: 2, w: 1, h: 1, dir: 0, color: '#ef4444', when: [{ field: 'outcome', op: 'is', values: ['ko'] }] },
  { id: 'b4', kind: 'belt', x: 16, y: 1, w: 1, h: 1, dir: 0 },
  { id: 'b5', kind: 'belt', x: 17, y: 1, w: 1, h: 1, dir: 1 },
  { id: 'b6', kind: 'belt', x: 17, y: 2, w: 1, h: 1, dir: 1 },
  { id: 'b13', kind: 'belt', x: 16, y: 2, w: 1, h: 1, dir: 1 },
  { id: 'b9', kind: 'belt', x: 15, y: 3, w: 1, h: 1, dir: 0 },
  { id: 'b10', kind: 'belt', x: 16, y: 3, w: 1, h: 1, dir: 0, fast: true },
  { id: 'br', kind: 'bridge', x: 17, y: 3, w: 1, h: 1 },
  { id: 'b11', kind: 'belt', x: 18, y: 3, w: 1, h: 1, dir: 0, fast: true },
  { id: 'b12', kind: 'belt', x: 19, y: 3, w: 1, h: 1, dir: 0 },
  { id: 'p_dep', kind: 'teleporter', x: 20, y: 3, w: 1, h: 1, role: 'departure', to: 'p_arr', name: 'to rework' },
  { id: 'b7', kind: 'belt', x: 17, y: 4, w: 1, h: 1, dir: 1 },
  { id: 'toll', kind: 'belt', x: 17, y: 5, w: 1, h: 1, dir: 1, set: [{ field: 'tag', op: 'inc', value: 'passes' }], toll: { when: [{ field: 'type', op: 'is', values: ['fix'] }], out: 0 } },
  { id: 'z_rej', kind: 'zone', x: 18, y: 5, w: 3, h: 2, name: 'Rejected', release: 'manual', status: 'backlog' },
  { id: 'b8', kind: 'belt', x: 17, y: 6, w: 1, h: 1, dir: 1 },
  { id: 'a5', kind: 'arm', x: 17, y: 7, w: 1, h: 1, dir: 1 },
  { id: 'st_skill', kind: 'station', x: 15, y: 8, w: 5, h: 4, name: 'Review', exec: 'skill', ref: 'pr-review', outcomes: ['ok'], cap: 3 },
  { id: 'a6', kind: 'arm', x: 14, y: 9, w: 1, h: 1, dir: 2 },
  { id: 'st_panel', kind: 'station', x: 9, y: 8, w: 5, h: 4, name: 'Debate', exec: 'panel', ref: 'architects', outcomes: ['ok'], cap: 3, off: true },
  { id: 'a7', kind: 'arm', x: 8, y: 9, w: 1, h: 1, dir: 2 },
  { id: 'st_script', kind: 'station', x: 3, y: 8, w: 5, h: 4, name: 'Tests', exec: 'script', outcomes: ['ok', 'ko', 'unconfigured'], cap: 2, script: { action: 'test', lines: [{ target: '*', kind: 'command', value: 'bun test' }], missing: 'own', onFail: 'all' } },
  { id: 'a8', kind: 'arm', x: 5, y: 12, w: 1, h: 1, dir: 1 },
  { id: 'st_gate', kind: 'station', x: 3, y: 13, w: 4, h: 4, name: 'Check spec', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 6 },
  { id: 'a9', kind: 'arm', x: 7, y: 14, w: 1, h: 1, dir: 0, when: [{ field: 'outcome', op: 'is', values: ['approve'] }] },
  { id: 'ex1', kind: 'exit', x: 8, y: 13, w: 3, h: 3, name: 'Shipped' },
  { id: 'a10', kind: 'arm', x: 4, y: 17, w: 1, h: 1, dir: 1, color: '#22c55e' },
  { id: 'st_native', kind: 'station', x: 3, y: 18, w: 3, h: 2, name: 'Set done', exec: 'native', outcomes: ['ok'], cap: 4, sets: 'done' },
  { id: 'p_arr', kind: 'teleporter', x: 22, y: 9, w: 1, h: 1, role: 'arrival', name: 'rework' },
  { id: 'a11', kind: 'arm', x: 22, y: 10, w: 1, h: 1, dir: 1 },
  { id: 'a12', kind: 'arm', x: 23, y: 9, w: 1, h: 1, dir: 2 },
  { id: 'z_auto', kind: 'zone', x: 21, y: 11, w: 5, h: 3, name: 'Ready', release: 'auto', status: 'todo', limit: 5 },
  { id: 'lb', kind: 'label', x: 0, y: 5, w: 1, h: 1, text: 'MAIN LINE' },
];

export const layout: FactoryLayout = { version: 2, w: 0, h: 0, machines: M };

const TYPES = ['build', 'fix', 'review', 'ops', 'lead', 'think', ''];
let n = 0;
/** A ticket in a machine (or loose, with no machine), in a phase. */
function tk(machineId: string | null, phase: TicketPhase, more: Partial<FactoryTicket> = {}, info: { type?: string; favorite?: boolean; priority?: string; status?: string } = {}): FactoryTicket {
  const i = n++, id = `t${i}`;
  return {
    ticketId: id, machineId, x: 0, y: 0, phase, p: 0.5, fx: 1, fy: 0, outcome: '', released: false, note: '', runId: null,
    since: `2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z`, handedAt: '2026-01-01T00:00:00.000Z',
    info: {
      id, displayId: 100 + i, title: `Ticket number ${100 + i} with a title`, type: info.type ?? TYPES[i % TYPES.length]!, priority: info.priority ?? 'medium',
      status: (info.status ?? 'doing') as never, tags: [], boardId: 'b', complexity: null, favorite: info.favorite ?? false,
    },
    ...more,
  };
}

export const tickets: FactoryTicket[] = [
  tk('z_in', 'zone'), tk('z_in', 'zone', {}, { favorite: true }), tk('z_in', 'zone', { released: true }),
  tk('b1', 'belt', { p: 0.3 }), tk('g1', 'belt', { p: 0.5 }, { priority: 'urgent' }), tk('b5', 'belt', { p: 0.5, fx: 1, fy: 0 }),
  tk('br', 'belt', { p: 0.4, fx: 0, fy: 1 }), tk('br', 'belt', { p: 0.7, fx: 1, fy: 0 }, { type: 'fix' }),
  tk('a2', 'arm'),
  tk('st_agent', 'running'), tk('st_agent', 'wait'), tk('st_agent', 'question', { outcome: 'question' }), tk('st_agent', 'out', { outcome: 'ok' }), tk('st_agent', 'out', { outcome: 'ko' }),
  tk('toll', 'arm', {}, { type: 'fix' }),
  tk('p_dep', 'port'),
  tk('st_skill', 'running'), tk('st_skill', 'failed'), tk('st_skill', 'out', { outcome: 'ok' }), tk('st_skill', 'aside'),
  tk('st_panel', 'wait'),
  tk('st_script', 'running', {}, { favorite: true, priority: 'high' }), tk('st_script', 'running'),
  tk('st_gate', 'review'), tk('st_gate', 'review', {}, { favorite: true }), tk('st_gate', 'out', { outcome: 'reject' }),
  tk('st_native', 'wait'),
  tk('a9', 'arm', { outcome: 'approve' }),
  tk('z_auto', 'zone', {}, { status: 'todo' }), tk('z_auto', 'zone', {}, { status: 'todo' }), tk('z_auto', 'zone', { released: true }, { status: 'todo' }),
  tk('z_rej', 'zone', {}, { type: 'fix' }),
  tk(null, 'loose', { x: 12, y: 15 }),
];

export const arms: ViewState['arms'] = new Map([
  ['a2', { p: 0.5, state: 'carry' as const }], ['a3', { p: 0, state: 'rest' as const }], ['a6', { p: 1, state: 'back' as const }],
  ['toll', { p: 0.6, state: 'carry' as const }], ['a9', { p: 0.95, state: 'carry' as const }],
]);

export const lens: LensLayer = {
  kind: 'cost', max: 4, legend: 'cost',
  values: new Map([['st_agent', 4], ['st_skill', 1.5], ['st_panel', 0.4], ['z_auto', 1]]),
  text: new Map([['st_agent', '$4.00'], ['st_skill', '$1.50'], ['st_panel', '$0.40'], ['z_auto', '$1.00']]),
};

/**
 * The floor a moment later: what the arm before the exit carried has left by it, and what waited in the departure
 * has jumped to its arrival. Drawn after the floor above, these are seen leaving and crossing.
 */
export const later: FactoryTicket[] = tickets
  .filter((t) => t.machineId !== 'a9')
  .map((t) => (t.machineId === 'p_dep' ? { ...t, machineId: 'p_arr' } : t));

/** The made-up floor as the page would hand it to the view: a ticket selected, a teleporter pointed at, filters on. */
export const floorState = (over: Partial<ViewState> = {}): ViewState => ({
  layout, tickets, arms, armAge: 0.2, armSwing: 1.1, beltSpeed: 1.2, fastBelt: 2,
  boardName: () => 'Main', modelOf: (m) => m.model ?? (m.exec === 'skill' || m.exec === 'panel' ? 'claude-opus-4-1' : null),
  selMachine: null, selMany: [], marquee: null, selTicket: 't9', selTickets: null, pickTickets: null, hoverMachine: 'p_dep',
  edit: false, ghost: null, drag: null, lens: null, dim: new Set(['t3']), found: new Set(['t16']), named: new Set(['t21']),
  exits: { ex1: 12 }, exitDays: 7,
  ...over,
});
