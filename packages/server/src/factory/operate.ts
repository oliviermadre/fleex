/**
 * The floor for whoever operates it without the page: the CLI, the MCP, another program.
 *
 * The page reads the whole snapshot four times a second and draws it. A command, or an agent calling a tool, wants
 * the answer to one question in a few lines: what is on the floor, where, and what waits for someone. So these are
 * pure readings of a snapshot, with no layout in them (a floor is thousands of belt tiles), and the edits of one
 * machine at a time, which the page never needed since it saves the whole layout.
 *
 * The words and the list of what waits follow the page's (`packages/web/src/factory/needs.ts`): the same ticket is
 * told the same way on both.
 */
import { randomUUID } from 'node:crypto';
import { FactoryError, setupGap, type FactorySnapshot } from './engine.js';
import { QUESTION_OUTCOME } from './conditions.js';
import { RUNS, SET_ASIDE, type FactoryLayout, type ItemSource, type MachineSpec, type TicketPhase } from './types.js';

export type NeedKind = 'decision' | 'question' | 'failed' | 'aside' | 'floor' | 'zone';
export const NEED_LABEL: Record<NeedKind, string> = { decision: 'decision', question: 'question', failed: 'run failed', aside: 'set aside', floor: 'on the floor', zone: 'waiting for you' };

type SnapshotTicket = FactorySnapshot['tickets'][number];

/** A ticket or an item on the floor, with where it stands and what can be done with it, in words. */
export interface FloorToken {
  /** The ticket's id, or the item's: what every `/api/factory/tickets/:id/...` route takes. */
  id: string;
  kind: 'ticket' | 'item';
  /** A ticket's number; null for an item, which has none. */
  displayId: number | null;
  title: string;
  type: string; priority: string; status: string | null; tags: string[];
  /** An item only: where it came from, and who from. */
  source?: ItemSource; author?: string; url?: string | null;
  machineId: string | null;
  /** Where it is, as the page says it: a machine's name, "On a belt", "Floor". */
  where: string;
  phase: TicketPhase;
  /** What happens to it there, in words. */
  state: string;
  /** What the last station concluded, when it did. */
  outcome: string;
  /** In a zone: allowed to leave. */
  released: boolean;
  note: string;
  since: string; handedAt: string;
  /** What it waits for from someone, or null when it waits for nobody. */
  need: NeedKind | null;
  /** What can be done with it now, as the names of the operations (see `actionsOf`). */
  actions: string[];
  /** In a station: the ways out it can be given (a gate's decisions, or what a set-aside ticket can leave as). */
  outcomes: string[];
}

export interface Need { token: FloorToken; kind: NeedKind; label: string; waitMs: number }

/** A machine without its settings: what a list shows. Its settings are its `spec`, asked for one machine at a time. */
export interface FloorMachine {
  id: string; kind: MachineSpec['kind']; name: string;
  x: number; y: number; w: number; h: number;
  /** A station: what runs in it, on what; whether it is switched off; what it lacks to run anything. */
  exec?: string; ref?: string; off?: boolean; gap?: string | null;
  /** A belt or an arm: the way it faces, in words. */
  dir?: string;
  /** An intake: its source, what it dropped over the last 24 hours and, when it is pulled (Gmail), its last pull and what went wrong with it. */
  source?: ItemSource; dropped?: number; pulledAt?: string | null; pullError?: string | null;
  /** How many tickets and items stand on it, and how many of them wait for someone. */
  holds: number; needs: number;
}

export const DIRS = ['east', 'south', 'west', 'north'] as const;

const kindName = (m: MachineSpec): string => m.kind === 'station' ? (m.exec === 'human_gate' ? 'Gate' : 'Station') : m.kind.charAt(0).toUpperCase() + m.kind.slice(1);
/** What a machine is called: its name, else what it is. A belt, a bridge and an arm are places, not names. */
export function nameOf(m: MachineSpec): string {
  if (m.kind === 'label') return m.text || 'Label';
  return (m.name ?? '').trim() || kindName(m);
}
function placeOf(m: MachineSpec | undefined): string {
  if (!m) return 'Floor';
  if (m.kind === 'belt' || m.kind === 'bridge') return 'On a belt';
  if (m.kind === 'arm') return 'In an arm';
  return nameOf(m);
}

function stateOf(t: SnapshotTicket): string {
  const as = t.outcome && t.outcome !== QUESTION_OUTCOME ? ` as ${t.outcome}` : '';
  switch (t.phase) {
    case 'review': return 'Waiting for a decision';
    /* why is in `note`: a failed run's error can be a page long */
    case 'failed': return 'The run failed';
    case 'aside': return 'Set aside';
    case 'question': return 'Asked a question';
    case 'running': return 'Running';
    case 'wait': return t.note || 'Waiting to start';
    case 'out': return `Done${as}, waiting to be taken`;
    case 'loose': return 'Lying there until it is put on a machine';
    case 'port': return 'In a teleporter';
    case 'zone': return t.outcome === QUESTION_OUTCOME ? 'Carries a question' : t.released ? 'Released, waiting to be taken' : 'Kept there';
    default: return t.outcome === QUESTION_OUTCOME ? 'Carries a question' : 'On its way';
  }
}

function needOf(t: SnapshotTicket, m: MachineSpec | undefined): NeedKind | null {
  if (t.phase === 'review') return 'decision';
  if (t.phase === 'failed') return 'failed';
  if (t.phase === 'aside') return 'aside';
  /* an unanswered question travels with its ticket (an arm that takes questions) until a station takes it again */
  if (t.phase === 'question' || t.outcome === QUESTION_OUTCOME) return 'question';
  if (t.phase === 'loose') return 'floor';
  /* a zone of work done by hand: its tickets wait for someone, released or not, for as long as they are in it */
  if (t.phase === 'zone' && m?.kind === 'zone' && m.needsYou) return 'zone';
  return null;
}

/**
 * What can be done with a ticket where it stands, as the engine would accept it now: a command that is not listed
 * would be refused. `move` and `take-back` are always possible.
 */
function actionsOf(t: SnapshotTicket, m: MachineSpec | undefined): string[] {
  const out: string[] = [], runs = m?.kind === 'station' && RUNS.includes(m.exec);
  if (t.phase === 'zone' && !t.released) out.push('release');
  if (t.phase === 'review') out.push('decide');
  if (runs && SET_ASIDE.includes(t.phase)) out.push('retry', 'put-back');
  if (runs && ['wait', 'running', 'out'].includes(t.phase)) out.push('aside');
  out.push('move', t.item ? 'archive' : 'take-back');
  return out;
}

function tokenOf(t: SnapshotTicket, m: MachineSpec | undefined): FloorToken {
  const station = m?.kind === 'station' ? m : null;
  return {
    id: t.ticketId, kind: t.item ? 'item' : 'ticket',
    displayId: t.item ? null : t.info?.displayId ?? null,
    title: t.info?.title ?? '(gone)',
    type: t.info?.type ?? '', priority: t.info?.priority ?? '', status: t.item ? null : t.info?.status ?? null, tags: t.info?.tags ?? [],
    ...(t.item ? { source: t.item.source, author: t.item.author, url: t.item.url } : {}),
    machineId: t.machineId, where: placeOf(m), phase: t.phase, state: stateOf(t),
    outcome: t.outcome, released: t.released, note: t.note, since: t.since, handedAt: t.handedAt,
    need: needOf(t, m), actions: actionsOf(t, m),
    outcomes: station && (t.phase === 'review' || SET_ASIDE.includes(t.phase)) ? station.outcomes : [],
  };
}

const machinesById = (s: FactorySnapshot): Map<string, MachineSpec> => new Map(s.floor.layout.machines.map((m) => [m.id, m]));

/** Every ticket and item on the floor, the one that has stood longest where it is first. */
export function tokens(s: FactorySnapshot): FloorToken[] {
  const byId = machinesById(s);
  return s.tickets.map((t) => tokenOf(t, t.machineId ? byId.get(t.machineId) : undefined)).sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}

export function token(s: FactorySnapshot, id: string): FloorToken | null {
  const t = s.tickets.find((x) => x.ticketId === id);
  return t ? tokenOf(t, t.machineId ? machinesById(s).get(t.machineId) : undefined) : null;
}

/** What waits for someone, and for what; the longest wait first. */
export function needs(s: FactorySnapshot): Need[] {
  const at = Date.parse(s.serverTime) || 0, out: Need[] = [];
  for (const t of tokens(s)) {
    if (!t.need) continue;
    const since = Date.parse(t.since);
    out.push({ token: t, kind: t.need, label: NEED_LABEL[t.need], waitMs: at && since ? Math.max(0, at - since) : 0 });
  }
  return out.sort((a, b) => b.waitMs - a.waitMs || a.token.id.localeCompare(b.token.id));
}

function machineOf(s: FactorySnapshot, m: MachineSpec, held: FloorToken[]): FloorMachine {
  return {
    id: m.id, kind: m.kind, name: nameOf(m), x: m.x, y: m.y, w: m.w, h: m.h,
    ...(m.kind === 'station' ? { exec: m.exec, ...(m.ref ? { ref: m.ref } : {}), off: m.off === true, gap: setupGap(m) } : {}),
    ...(m.kind === 'belt' || m.kind === 'arm' ? { dir: DIRS[m.dir] } : {}),
    ...(m.kind === 'intake' ? { source: m.source, ...(s.intakes?.[m.id] ?? {}) } : {}),
    holds: held.length, needs: held.filter((t) => t.need).length,
  };
}

/** The machines of the floor, as they were built, each with what stands on it. */
export function machines(s: FactorySnapshot): FloorMachine[] {
  const held = new Map<string, FloorToken[]>();
  for (const t of tokens(s)) if (t.machineId) held.set(t.machineId, [...(held.get(t.machineId) ?? []), t]);
  return s.floor.layout.machines.map((m) => machineOf(s, m, held.get(m.id) ?? []));
}

/** One machine: what a list says of it, its settings as the layout holds them, and what stands on it. */
export function machine(s: FactorySnapshot, id: string): (FloorMachine & { spec: MachineSpec; tokens: FloorToken[] }) | null {
  const spec = s.floor.layout.machines.find((m) => m.id === id);
  if (!spec) return null;
  const held = tokens(s).filter((t) => t.machineId === id);
  return { ...machineOf(s, spec, held), spec, tokens: held };
}

export interface FloorOverview {
  floor: { id: string; name: string };
  halted: boolean;
  limits: { maxRunsPerHour: number; maxConcurrentRuns: number };
  runsLastHour: number; running: number;
  tickets: number; items: number;
  /** How many wait for someone, by what they wait for. */
  needs: number; needsByKind: Partial<Record<NeedKind, number>>;
  /** How many machines of each kind are built. */
  machines: Record<string, number>;
  /** Stations that take tickets in and start nothing: switched off, or not set up. */
  idleStations: { id: string; name: string; why: string }[];
  notice: string | null;
  serverTime: string;
}

/** The floor at a glance: is it running, how full, what waits. */
export function overview(s: FactorySnapshot): FloorOverview {
  const all = needs(s), needsByKind: Partial<Record<NeedKind, number>> = {}, counts: Record<string, number> = {};
  for (const n of all) needsByKind[n.kind] = (needsByKind[n.kind] ?? 0) + 1;
  const idleStations: FloorOverview['idleStations'] = [];
  for (const m of s.floor.layout.machines) {
    counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    if (m.kind !== 'station' || !RUNS.includes(m.exec)) continue;
    const gap = setupGap(m);
    if (gap) idleStations.push({ id: m.id, name: nameOf(m), why: `not set up (${gap})` });
    else if (m.off) idleStations.push({ id: m.id, name: nameOf(m), why: 'switched off' });
  }
  const items = s.tickets.filter((t) => t.item).length;
  return {
    floor: { id: s.floor.id, name: s.floor.name },
    halted: s.floor.settings.halted === true,
    limits: { maxRunsPerHour: s.floor.settings.maxRunsPerHour, maxConcurrentRuns: s.floor.settings.maxConcurrentRuns },
    runsLastHour: s.runsLastHour, running: s.running,
    tickets: s.tickets.length - items, items,
    needs: all.length, needsByKind, machines: counts, idleStations,
    notice: s.notice, serverTime: s.serverTime,
  };
}

// ---------- one machine at a time ----------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The layout with machines added. A machine comes as its spec, as the layout holds it (`types.ts`); its id is given
 * when it has none. What cannot be built (two machines on one tile, a station with no executor) is refused by the
 * save, as for a layout sent whole.
 */
export function withMachines(layout: FactoryLayout, input: unknown): { layout: FactoryLayout; ids: string[] } {
  const list = Array.isArray(input) ? input : [input];
  if (!list.length) throw new FactoryError('no machine to add');
  if (list.length > 2_000) throw new FactoryError('too many machines at once');
  const taken = new Set(layout.machines.map((m) => m.id)), added: MachineSpec[] = [];
  for (const raw of list) {
    if (!isRecord(raw) || typeof raw['kind'] !== 'string') throw new FactoryError('a machine needs a kind (belt, arm, station, zone, exit…)');
    if (!Number.isFinite(Number(raw['x'])) || !Number.isFinite(Number(raw['y']))) throw new FactoryError('a machine needs a position: x and y, in tiles');
    const id = typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : randomUUID();
    if (taken.has(id)) throw new FactoryError(`a machine with the id ${id} is already on the floor`);
    taken.add(id);
    added.push({ ...raw, id, x: Number(raw['x']), y: Number(raw['y']) } as unknown as MachineSpec);
  }
  return { layout: { ...layout, machines: [...layout.machines, ...added] }, ids: added.map((m) => m.id) };
}

/**
 * The layout with one machine changed: what the patch names replaces what the machine had, and a null takes it off
 * (`{ "model": null }`). A machine stays what it is: neither its id nor its kind changes.
 */
export function withMachinePatched(layout: FactoryLayout, id: string, patch: unknown): FactoryLayout {
  if (!isRecord(patch)) throw new FactoryError('the change to a machine is an object of its settings');
  const index = layout.machines.findIndex((m) => m.id === id);
  if (index < 0) throw new FactoryError('Unknown machine');
  const before = layout.machines[index]!, next: Record<string, unknown> = { ...before };
  if (patch['id'] !== undefined && patch['id'] !== id) throw new FactoryError('the id of a machine does not change');
  if (patch['kind'] !== undefined && patch['kind'] !== before.kind) throw new FactoryError(`a ${before.kind} stays a ${before.kind}: remove it and add the other`);
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
  const machines = [...layout.machines];
  machines[index] = next as unknown as MachineSpec;
  return { ...layout, machines };
}

/** The layout without one machine. What stood on it is left on the floor where it stood. */
export function withoutMachine(layout: FactoryLayout, id: string): FactoryLayout {
  if (!layout.machines.some((m) => m.id === id)) throw new FactoryError('Unknown machine');
  return { ...layout, machines: layout.machines.filter((m) => m.id !== id) };
}
