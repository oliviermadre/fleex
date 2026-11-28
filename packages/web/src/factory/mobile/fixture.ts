/** A small made-up floor for the tests of the phone's Factory: a line with a zone, two stations, a gate, a zone of work done by hand and an exit. */
import type { FactorySnapshot, FactoryTicket, FactoryTicketInfo, MachineSpec, TicketPhase } from '../types';

export const NOW = '2026-01-01T12:00:00.000Z';
export const MACHINES: MachineSpec[] = [
  { id: 'inbound', kind: 'zone', x: 0, y: 4, w: 5, h: 5, name: 'Inbound', release: 'manual', inbound: true },
  { id: 'belt', kind: 'belt', x: 5, y: 6, w: 1, h: 1, dir: 0 },
  { id: 'arm', kind: 'arm', x: 6, y: 6, w: 1, h: 1, dir: 0 },
  { id: 'build', kind: 'station', x: 8, y: 4, w: 5, h: 5, name: 'Build', exec: 'agent', outcomes: ['done', 'blocked'], cap: 2 },
  { id: 'tests', kind: 'station', x: 16, y: 4, w: 5, h: 5, name: 'Tests', exec: 'script', outcomes: ['ok', 'ko'], cap: 2 },
  { id: 'gate', kind: 'station', x: 24, y: 4, w: 5, h: 5, name: 'PR Review', exec: 'human_gate', outcomes: ['approve', 'reject', 'fix-first'], cap: 8 },
  { id: 'qa', kind: 'zone', x: 24, y: 12, w: 5, h: 5, name: 'Manual QA', release: 'manual', needsYou: true },
  { id: 'desk', kind: 'desk', x: 0, y: 0, w: 3, h: 3, name: 'New ticket' },
  { id: 'exit', kind: 'exit', x: 32, y: 5, w: 3, h: 3, name: 'Shipped' },
];

const info = (n: number, title: string, over: Partial<FactoryTicketInfo> = {}): FactoryTicketInfo =>
  ({ id: `t${n}`, displayId: n, title, type: 'bug', priority: 'high', status: 'doing', tags: [], boardId: 'b1', complexity: null, favorite: false, ...over });

/** A ticket of the floor: `#n`, where it stands, for how many minutes. */
export function tk(n: number, machineId: string | null, phase: TicketPhase, minutes = 1, over: Partial<FactoryTicket> & { title?: string; tags?: string[] } = {}): FactoryTicket {
  const { title, tags, ...rest } = over;
  return {
    ticketId: `t${n}`, machineId, info: info(n, title ?? `Ticket ${n}`, tags ? { tags } : {}), x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false,
    since: new Date(Date.parse(NOW) - minutes * 60_000).toISOString(), runId: null, note: '', handedAt: '', ...rest,
  };
}

export function snapshotOf(tickets: FactoryTicket[], machines: MachineSpec[] = MACHINES): FactorySnapshot {
  return {
    floor: { id: 'f', name: 'Floor', layout: { w: 40, h: 20, machines }, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } },
    tickets, arms: [], runsLastHour: 0, running: tickets.filter((t) => t.phase === 'running').length, serverTime: NOW,
  };
}
