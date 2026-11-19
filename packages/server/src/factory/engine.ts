import { normaliseScript, scriptOutcomes } from './script-runner.js';
import { applyOps, normaliseOps, type TicketChange } from './set-ops.js';
import { randomUUID } from 'node:crypto';
import { LAYOUT_VERSION, upgradeLayout } from './layout-versions.js';
import type { TicketStatus } from '@fleex/shared';
import type { FactoryStorePort } from './factory-store.port.js';
import type { StationRunnerPort } from './station-runner.js';
import { acceptsOutcome, holds, isConditional, matches as armMatches, normaliseConditions, normaliseList, QUESTION_OUTCOME, takesQuestions } from './conditions.js';
import {
  DEFAULT_FLOOR_ID, DEFAULT_SETTINGS, DX, DY, GROUP_SLOTS, ITEM_SOURCES, RUNS, SET_ASIDE,
  type ArmSpec, type BeltSpec, type DropRule, type FactoryFloorRow, type FactoryGroup, type FactoryItemInfo, type FactoryItemRow, type FactoryLayout, type FactoryRunRow, type FactorySettings,
  type FactoryTicketInfo, type FactoryTicketState, type IntakeSpec, type ItemInput, type MachineSpec, type StationSpec, type ZoneSpec,
} from './types.js';

/** Tiles per second on a belt. */
const BELT_SPEED = 1.2;
/** How many times faster a fast belt carries a ticket. */
export const FAST_BELT = 2;
/** Seconds for an arm to swing one way: slow enough for the half turn to be watched. */
const ARM_SWING = 1.1;
/** How long a ticket rests in a station once it is done there, before an arm may take it: long enough to be seen. */
const STATION_REST_MS = 1000;
/** How long a ticket stays in a teleporter before it is sent on, or taken out: long enough to be seen there. */
const TELEPORT_REST_MS = 800;
const FLUSH_EVERY_MS = 2000;
/* a full re-read of every ticket on the floor, as a safety net: what is changed in Fleex reaches the floor by its events, at once */
const REFRESH_INFO_EVERY_MS = 30_000;
/* how many tickets are re-read at once: on a remote database each read is a round trip */
const REFRESH_CONCURRENCY = 8;
const HOUR_MS = 3_600_000;
/** What an intake's DROPPED counter covers. */
const DROPPED_WINDOW_MS = 24 * HOUR_MS;
/** How long an intake keeps a conversation that moves, unless it says otherwise. */
const DEFAULT_QUIET_SEC = 120;

interface Machine {
  spec: MachineSpec;
  /** Arms that take from this machine. */
  takers: Machine[];
  src: Machine | null;
  dst: Machine | null;
  /** Belts: the ticket on the tile. Arms: the ticket in the gripper. Bridges: the ticket travelling east-west. Teleporters: the ticket it holds. */
  item: Ticket | null;
  /** Bridges: the ticket travelling north-south. */
  item2: Ticket | null;
  armState: 'rest' | 'carry' | 'back';
  armP: number;
  /** A belt with a gantry: whether what it changed on the ticket it holds is being written, or could not be. */
  gate: 'idle' | 'writing' | 'failed';
  gateRetryAt: number;
}
interface Ticket {
  ticketId: string;
  machineId: string | null;
  s: FactoryTicketState;
  createdAt: string;
  info: FactoryTicketInfo | null;
  /** Set when this is an item and not a ticket: its row, which is where it is saved. */
  item?: FactoryItemRow;
}

/**
 * What arms and tolls see of an item: the type `src:<its source>` (what the page draws it from), no priority, no board,
 * and its tags with `source:<its source>` added, so that "type is src:slack" or "tag value source is slack" routes it.
 */
export function itemInfo(row: FactoryItemRow): FactoryTicketInfo {
  return {
    id: row.id, displayId: 0, title: row.title, type: `src:${row.source}`, priority: 'none', status: 'todo', tags: [...row.tags.filter((t) => !t.startsWith('source:')), `source:${row.source}`],
    boardId: '', complexity: null, favorite: false, blocked: false,
  };
}
const itemOf = (row: FactoryItemRow): FactoryItemInfo => ({ source: row.source, author: row.author, excerpt: row.excerpt, url: row.url, messages: row.messages, lastActivityAt: row.lastActivityAt });
/** Whether one of an intake's rules drops this conversation. */
export function dropsIt(rules: readonly DropRule[] | undefined, i: { title: string; author: string; excerpt: string }): DropRule | null {
  for (const r of rules ?? []) {
    const needle = r.contains.trim().toLowerCase(); if (!needle) continue;
    const hay = r.field === 'author' ? i.author : r.field === 'title' ? i.title : `${i.title}\n${i.excerpt}`;
    if (hay.toLowerCase().includes(needle)) return r;
  }
  return null;
}

export interface FactorySnapshot {
  floor: { id: string; name: string; layout: FactoryLayout; settings: FactorySettings };
  tickets: (FactoryTicketState & { ticketId: string; machineId: string | null; info: FactoryTicketInfo | null; /** When it was handed over to the Factory (ISO). */ handedAt: string; /** Set on an item, which is not a ticket. */ item?: FactoryItemInfo })[];
  /** What each intake dropped over the last 24 hours, by its id. */
  intakes?: Record<string, { dropped: number }>;
  /** `p` is how far each arm has swung (0 at its source, 1 at its destination) and `state` which way it is going, so the page can carry the motion on between two snapshots. */
  arms: { id: string; p: number; state: 'rest' | 'carry' | 'back'; carrying: string | null }[];
  /** Seconds an arm takes to swing one way. */
  armSwing: number;
  /** Tiles a belt carries a ticket per second, and how many times faster a fast belt does: the page draws tickets moving at that pace between two snapshots. */
  beltSpeed: number;
  fastBelt: number;
  runsLastHour: number;
  running: number;
  serverTime: string;
  /** Something to tell the human once (the floor was started over for a new layout version), or null. */
  notice: string | null;
}

export interface FactoryEngineDeps {
  store: FactoryStorePort;
  runner: StationRunnerPort;
  /** Null when the ticket is gone or archived: the Factory lets go of it. */
  loadTicket(ticketId: string): Promise<FactoryTicketInfo | null>;
  setStatus(ticketId: string, status: TicketStatus): Promise<void>;
  /** Write on a ticket what a Set gantry changed. The gantry holds the ticket until this resolves. */
  applyChange?(ticketId: string, change: TicketChange): Promise<void>;
  logger: { warn(msg: string, meta?: Record<string, unknown>): void; info(msg: string, meta?: Record<string, unknown>): void };
  now?: () => number;
  /** Stop the agent execution a run started: a human took the ticket off the station while it ran. */
  cancelExecution?(executionId: string): Promise<unknown>;
  /** Write a gate decision in the ticket's thread, in the human's name. */
  recordDecision?(ticketId: string, gate: string, outcome: string, reason: string): Promise<void>;
  /** Paces of the floor, for tests that do not want to wait for them. */
  timing?: { armSwing?: number; stationRestMs?: number; teleportRestMs?: number };
}

export class FactoryError extends Error {}

/** The zone a handed-over ticket lands in: it sets no status and keeps tickets until they are moved or released. */
function inboundZone(x: number, y: number): ZoneSpec {
  return { id: randomUUID(), kind: 'zone', x, y, w: 4, h: 6, name: 'Inbound', status: '', release: 'manual', inbound: true };
}
/** A floor as it starts: only Inbound, in the middle of the smallest floor the page shows (300 tiles by 150, from 0,0). */
function freshLayout(): FactoryLayout {
  return { version: LAYOUT_VERSION, w: 4, h: 6, machines: [inboundZone(148, 72)] };
}

/*
 * `question` is the outcome a run gets when the agent asks instead of answering. Only an arm that asks for it takes
 * such a ticket out of its station: any other arm leaves it there, so an unanswered ticket never carries on down the
 * normal path.
 */
export { QUESTION_OUTCOME };
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.length > 0 && v.every(isId) ? v : null);
/** The saved selections as the web sent them, made safe to keep: always `GROUP_SLOTS` slots, anything malformed an empty one. */
export function cleanGroups(input: unknown): FactoryGroup[] {
  const list = Array.isArray(input) ? input : [];
  return Array.from({ length: GROUP_SLOTS }, (_, i): FactoryGroup => {
    const g = list[i] as Record<string, unknown> | null | undefined;
    if (!g || typeof g !== 'object') return null;
    if (isId(g['machine'])) return { machine: g['machine'] };
    if (isId(g['ticket'])) return { ticket: g['ticket'] };
    const machines = ids(g['machines']); if (machines) return { machines };
    const tickets = ids(g['tickets']); if (tickets) return { tickets };
    return null;
  });
}
function isBox(m: Machine | null): boolean { return !!m && (m.spec.kind === 'station' || m.spec.kind === 'zone' || m.spec.kind === 'exit' || m.spec.kind === 'desk' || m.spec.kind === 'intake'); }
/** A desk's defaults as the page sent them: short strings, and nothing else. */
function cleanDefaults(input: unknown): { boardId?: string; type?: string; priority?: string } | undefined {
  const d = input && typeof input === 'object' ? input as Record<string, unknown> : {}, out: Record<string, string> = {};
  for (const k of ['boardId', 'type', 'priority'] as const) if (typeof d[k] === 'string' && d[k].trim()) out[k] = (d[k] as string).trim().slice(0, 120);
  return Object.keys(out).length ? out : undefined;
}

/** Reject a layout that cannot be built: out of bounds, overlapping, or with malformed machines. Returns it normalised. */
export function normaliseLayout(input: FactoryLayout): FactoryLayout {
  if (!Array.isArray(input?.machines)) throw new FactoryError('layout.machines must be an array');
  if (input.machines.length > 20_000) throw new FactoryError('too many machines');
  const taken = new Set<string>(), ids = new Set<string>(), machines: MachineSpec[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const raw of input.machines) {
    const m = { ...raw } as MachineSpec;
    if (!m || typeof m.id !== 'string' || !m.id || ids.has(m.id)) throw new FactoryError('every machine needs a unique id');
    ids.add(m.id);
    m.x = Math.floor(m.x); m.y = Math.floor(m.y);
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || Math.abs(m.x) > 100_000 || Math.abs(m.y) > 100_000) throw new FactoryError(`machine ${m.id} has no usable position`);
    if (m.kind === 'belt' || m.kind === 'arm' || m.kind === 'label' || m.kind === 'bridge') {
      m.w = 1; m.h = 1;
      if (m.kind === 'arm') {
        m.when = normaliseConditions(m); delete m.filter;
        /* a colour is paint, nothing more: kept when it is one, dropped otherwise */
        if (typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color)) m.color = m.color.toLowerCase(); else delete m.color;
      }
      if (m.kind === 'belt') {
        if (m.fast === true) m.fast = true; else delete m.fast;
        if (m.toll) {
          /* a toll is a gantry, and its arm reaches across the belt, never along it */
          const out = [0, 1, 2, 3].includes(m.toll.out) && (m.toll.out + m.dir) % 2 === 1 ? m.toll.out : (((m.dir + 1) % 4) as 0 | 1 | 2 | 3);
          m.toll = { when: normaliseList(m.toll.when), out };
          if (m.set === undefined) m.set = [];
        } else delete m.toll;
        if (m.set !== undefined) m.set = normaliseOps(m.set);
      }
    }
    else if (m.kind === 'teleporter') {
      m.w = 1; m.h = 1;
      m.role = m.role === 'arrival' ? 'arrival' : 'departure';
      m.name = typeof m.name === 'string' ? m.name.trim().slice(0, 40) : '';
      if (typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color)) m.color = m.color.toLowerCase(); else delete m.color;
      /* only a departure leads somewhere; where to is checked once every machine is known */
      if (m.role !== 'departure' || typeof m.to !== 'string' || !m.to) delete m.to;
    }
    else if (m.kind === 'station') {
      /* a status station is two tiles a side; the others are machines the page draws with places, a tray and a bay: 5 by 4 unless said otherwise */
      if (m.exec === 'native') { m.w = 2; m.h = 2; }
      else { m.w = Math.max(3, Math.min(8, Math.floor(m.w || 5))); m.h = Math.max(3, Math.min(6, Math.floor(m.h || 4))); }
      m.outcomes = Array.isArray(m.outcomes) && m.outcomes.length ? m.outcomes.map(String).filter(Boolean) : ['ok'];
      if (!m.outcomes.length) m.outcomes = ['ok'];
      m.cap = Math.max(1, Math.min(50, Math.floor(m.cap || 8)));
      if (!['agent', 'skill', 'panel', 'script', 'human_gate', 'native'].includes(m.exec)) throw new FactoryError(`unknown station executor "${String(m.exec)}"`);
      /* a script station concludes by itself: its ways out are its own, and follow what it is told about a repository it has nothing to run for */
      if (m.exec === 'script') { m.script = normaliseScript(m.script); m.outcomes = scriptOutcomes(m.script); } else delete m.script;
      m.model = (m.exec === 'agent' || m.exec === 'skill') && typeof m.model === 'string' && m.model.trim() ? m.model.trim().slice(0, 120) : undefined;
      if (m.off === true && RUNS.includes(m.exec)) m.off = true; else delete m.off;
      if (typeof m.prompt === 'string' && m.prompt.length > 60_000) throw new FactoryError(`the instructions of ${m.name || 'a station'} are too long`);
    } else if (m.kind === 'zone') {
      m.w = Math.max(2, Math.min(30, Math.floor(m.w || 4))); m.h = Math.max(2, Math.min(30, Math.floor(m.h || 4)));
      m.release = m.release === 'auto' ? 'auto' : 'manual';
      m.inbound = m.inbound === true && !machines.some((o) => o.kind === 'zone' && o.inbound);
    } else if (m.kind === 'exit') { m.w = Math.max(1, Math.min(60, Math.floor(m.w || 3))); m.h = Math.max(1, Math.min(60, Math.floor(m.h || 3))); }
    else if (m.kind === 'desk') {
      /* a desk is a dock of three tiles by two, whatever the page sent */
      m.w = 3; m.h = 2;
      m.name = typeof m.name === 'string' ? m.name.trim().slice(0, 40) : '';
      const defaults = cleanDefaults(m.defaults); if (defaults) m.defaults = defaults; else delete m.defaults;
    }
    else if (m.kind === 'intake') {
      /* a dock of three by two, as a desk */
      m.w = 3; m.h = 2;
      if (!ITEM_SOURCES.includes(m.source)) throw new FactoryError(`unknown item source "${String(m.source)}"`);
      m.name = typeof m.name === 'string' ? m.name.trim().slice(0, 40) : '';
      m.quietSec = Math.max(0, Math.min(7 * 86_400, Math.floor(Number(m.quietSec ?? DEFAULT_QUIET_SEC) || 0)));
      m.drop = (Array.isArray(m.drop) ? m.drop : [])
        .filter((r) => r && ['author', 'title', 'text'].includes(r.field) && typeof r.contains === 'string' && r.contains.trim())
        .slice(0, 100).map((r) => ({ field: r.field, contains: r.contains.trim().slice(0, 200) }));
    }
    else throw new FactoryError(`unknown machine kind "${String((m as { kind?: string }).kind)}"`);
    if ((m.kind === 'belt' || m.kind === 'arm') && ![0, 1, 2, 3].includes(m.dir)) throw new FactoryError('belts and arms need a direction 0..3');
    if (m.kind !== 'label') for (let j = m.y; j < m.y + m.h; j++) for (let i = m.x; i < m.x + m.w; i++) {
      const k = `${i},${j}`;
      if (taken.has(k)) throw new FactoryError(`two machines overlap at ${k}`);
      taken.add(k);
    }
    x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h);
    machines.push(m);
  }
  /* a departure leads to an arrival of this floor, or nowhere: it then keeps what it is given, and the page says so */
  const arrivals = new Set(machines.filter((m) => m.kind === 'teleporter' && m.role === 'arrival').map((m) => m.id));
  for (const m of machines) if (m.kind === 'teleporter' && m.to && !arrivals.has(m.to)) delete m.to;
  /* the floor has no edge: `w` and `h` only record how far what is built extends */
  return { version: LAYOUT_VERSION, w: machines.length ? x1 - x0 : 0, h: machines.length ? y1 - y0 : 0, machines };
}

/**
 * The floor, as it runs. Nothing is routed in advance: a ticket reacts to what
 * it stands on. The engine owns the in-memory state, persists what changes, and
 * is the only writer of the three `factory_*` tables.
 */
export class FactoryEngine {
  private floor: FactoryFloorRow = { id: DEFAULT_FLOOR_ID, name: 'Factory', layout: freshLayout(), settings: { ...DEFAULT_SETTINGS }, createdAt: '', updatedAt: '' };
  private machines: Machine[] = [];
  private byId = new Map<string, Machine>();
  private grid = new Map<string, Machine>();
  private tickets = new Map<string, Ticket>();
  private dirty = new Set<string>();
  private runStarts: number[] = [];
  /** Runs in flight, by id: what a human stopping one needs to find its execution. */
  private openRuns = new Map<string, FactoryRunRow>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastFlush = 0;
  private lastRefresh = 0;
  private ready = false;
  private sweeping: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  /** Something the page should tell once: the floor was started over because its layout could not be carried to this version. */
  private notice: string | null = null;
  /** The item on the floor for each conversation, by `source\u0000key`. */
  private itemKeys = new Map<string, string>();
  /** What each intake dropped since the window began, by its id. */
  private dropped = new Map<string, number>();
  private readonly now: () => number;
  private readonly armSwing: number;
  private readonly restMs: number;
  private readonly portMs: number;

  constructor(private readonly deps: FactoryEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.armSwing = deps.timing?.armSwing ?? ARM_SWING;
    this.restMs = deps.timing?.stationRestMs ?? STATION_REST_MS;
    this.portMs = deps.timing?.teleportRestMs ?? TELEPORT_REST_MS;
  }

  // ---------- lifecycle ----------

  /** Load the floor and its tickets. Runs left `running` by a previous process are flagged, their tickets wait for a human. */
  async init(): Promise<void> {
    const nowIso = new Date(this.now()).toISOString();
    const existing = await this.deps.store.getFloor(DEFAULT_FLOOR_ID);
    let startedOver = false;
    if (existing) {
      this.floor = { ...existing, settings: { ...DEFAULT_SETTINGS, ...existing.settings } };
      const { layout, from } = upgradeLayout(existing.layout);
      if (layout && layout !== existing.layout) { this.floor = { ...this.floor, layout, updatedAt: nowIso }; await this.deps.store.saveFloor(this.floor); }
      else if (!layout) {
        /* it cannot be carried over: keep it as it was under another id, and start from an empty floor */
        await this.deps.store.saveFloor({ ...existing, id: `${DEFAULT_FLOOR_ID}@v${from}-${this.now()}`, name: `${existing.name} (layout v${from})`, updatedAt: nowIso });
        this.floor = { ...this.floor, layout: freshLayout(), updatedAt: nowIso };
        await this.deps.store.saveFloor(this.floor);
        startedOver = true;
        this.notice = `The floor was started over: machines changed size (layout v${from} to v${LAYOUT_VERSION}) and what was built could not be carried over. The previous layout is kept as an archive, and the tickets are back in Inbound. Import your plans again.`;
        this.deps.logger.info('Factory: the floor was started over for a new layout version', { from, to: LAYOUT_VERSION });
      }
    } else { this.floor = { ...this.floor, createdAt: nowIso, updatedAt: nowIso }; await this.deps.store.saveFloor(this.floor); }
    this.build(this.floor.layout);
    const interrupted = new Set((await this.deps.store.interruptRunningRuns(nowIso)).map((r) => r.id));
    for (const row of await this.deps.store.listTickets(this.floor.id)) {
      const t: Ticket = { ticketId: row.ticketId, machineId: row.machineId, s: row.state, createdAt: row.createdAt, info: null };
      if (t.s.phase === 'running') { t.s.phase = 'failed'; t.s.note = interrupted.has(t.s.runId ?? '') ? 'Run interrupted by a server restart' : 'Run interrupted'; this.dirty.add(t.ticketId); }
      this.tickets.set(t.ticketId, t);
      if (startedOver) { const inbound = this.machines.find((m) => m.spec.kind === 'zone' && m.spec.inbound); if (inbound) { this.accept(inbound, t); t.s.outcome = ''; continue; } }
      this.attach(t);
    }
    for (const row of await this.deps.store.listItems(this.floor.id)) {
      const t: Ticket = { ticketId: row.id, machineId: row.machineId, s: row.state ?? this.looseState(), createdAt: row.createdAt, info: itemInfo(row), item: row };
      this.tickets.set(t.ticketId, t); this.itemKeys.set(`${row.source}\u0000${row.sourceKey}`, row.id);
      if (startedOver) { const inbound = this.machines.find((m) => m.spec.kind === 'zone' && m.spec.inbound); if (inbound) { this.accept(inbound, t); t.s.outcome = ''; continue; } }
      this.attach(t);
    }
    this.dropped = new Map(Object.entries(await this.deps.store.countDropped(this.floor.id, new Date(this.now() - DROPPED_WINDOW_MS).toISOString())));
    const sinceIso = new Date(this.now() - HOUR_MS).toISOString();
    const n = await this.deps.store.countRunsSince(this.floor.id, sinceIso);
    for (let i = 0; i < n; i++) this.runStarts.push(this.now());
    await this.refreshInfos();
    this.ready = true;
  }

  /** Start ticking. `enabled` is read at every tick, so the flag can be flipped without a restart. */
  start(enabled: () => boolean, everyMs = 250): void {
    if (this.timer) return;
    this.lastTick = this.now();
    this.timer = setInterval(() => {
      const t = this.now(), dt = Math.min(1, (t - this.lastTick) / 1000);
      this.lastTick = t;
      /* `enabled` first: it is what loads the floor */
      if (!enabled() || !this.ready) return;
      try { this.tick(dt); } catch (err) { this.deps.logger.warn('Factory tick failed', { error: err instanceof Error ? err.message : String(err) }); }
      if (t - this.lastFlush > FLUSH_EVERY_MS) { this.lastFlush = t; void this.flush(); }
      if (t - this.lastRefresh > REFRESH_INFO_EVERY_MS) { this.lastRefresh = t; void this.refreshInfos(); }
    }, everyMs);
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
  }

  async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer = null; await this.flush(); }

  // ---------- floor ----------

  private at(x: number, y: number): Machine | null { return this.grid.get(`${x},${y}`) ?? null; }

  private build(layout: FactoryLayout): void {
    this.machines = layout.machines.map((spec) => ({ spec, takers: [], src: null, dst: null, item: null, item2: null, armState: 'rest' as const, armP: 0, gate: 'idle' as const, gateRetryAt: 0 }));
    this.byId = new Map(this.machines.map((m) => [m.spec.id, m]));
    this.grid = new Map();
    for (const m of this.machines) {
      if (m.spec.kind === 'label') continue;
      for (let j = m.spec.y; j < m.spec.y + m.spec.h; j++) for (let i = m.spec.x; i < m.spec.x + m.spec.w; i++) this.grid.set(`${i},${j}`, m);
    }
    for (const m of this.machines) {
      if (m.spec.kind !== 'arm') continue;
      const d = m.spec.dir;
      m.src = this.at(m.spec.x - DX[d], m.spec.y - DY[d]); m.dst = this.at(m.spec.x + DX[d], m.spec.y + DY[d]);
      if (m.src) m.src.takers.push(m);
    }
  }

  /** Put a loaded ticket back on the machine it was saved on; if that machine is gone, it lies on the floor. */
  private attach(t: Ticket): void {
    const m = t.machineId ? this.byId.get(t.machineId) ?? null : null;
    if (!m) { if (t.machineId || t.s.phase !== 'loose') { t.machineId = null; t.s.phase = 'loose'; this.dirty.add(t.ticketId); } return; }
    /* what a toll's arm was carrying goes back under the toll: it was rejected, and will be again */
    if (m.spec.kind === 'belt' && t.s.phase === 'arm') { t.s.phase = 'belt'; t.s.p = 0.5; this.dirty.add(t.ticketId); }
    if (m.spec.kind === 'belt' || m.spec.kind === 'teleporter') { if (m.item) { t.machineId = null; t.s.phase = 'loose'; this.dirty.add(t.ticketId); } else m.item = t; }
    else if (m.spec.kind === 'bridge') { const lane = t.s.fx !== 0 ? 'item' : 'item2'; if (m[lane]) { t.machineId = null; t.s.phase = 'loose'; this.dirty.add(t.ticketId); } else m[lane] = t; }
    else if (m.spec.kind === 'arm') { if (m.item) { t.machineId = null; t.s.phase = 'loose'; this.dirty.add(t.ticketId); } else { m.item = t; m.armState = 'carry'; m.armP = t.s.p; } }
  }

  /** Replace the layout. Tickets standing on a machine that disappears are left on the floor where it stood. */
  async setLayout(input: FactoryLayout): Promise<void> {
    const layout = normaliseLayout(input);
    this.floor = { ...this.floor, layout, updatedAt: new Date(this.now()).toISOString() };
    this.build(layout);
    for (const t of this.tickets.values()) {
      const m = t.machineId ? this.byId.get(t.machineId) : null;
      if (m && t.s.phase === 'running' && m.spec.kind !== 'station') { t.s.phase = 'loose'; t.machineId = null; this.dirty.add(t.ticketId); continue; }
      if (m && (m.spec.kind === 'station' || m.spec.kind === 'zone' || m.spec.kind === 'desk' || m.spec.kind === 'intake')) { t.s.x = m.spec.x; t.s.y = m.spec.y; continue; }
      if (!m && t.machineId) this.dirty.add(t.ticketId);
      this.attach(t);
    }
    await this.deps.store.saveFloor(this.floor);
    await this.flush();
  }

  async setSettings(patch: Partial<FactorySettings>): Promise<void> {
    const s = { ...this.floor.settings };
    if (patch.maxRunsPerHour != null) s.maxRunsPerHour = Math.max(0, Math.min(500, Math.floor(patch.maxRunsPerHour)));
    if (patch.maxConcurrentRuns != null) s.maxConcurrentRuns = Math.max(1, Math.min(50, Math.floor(patch.maxConcurrentRuns)));
    if (patch.groups !== undefined) s.groups = cleanGroups(patch.groups);
    this.floor = { ...this.floor, settings: s, updatedAt: new Date(this.now()).toISOString() };
    await this.deps.store.saveFloor(this.floor);
  }

  // ---------- tickets ----------

  private inside(m: Machine): Ticket[] {
    const out: Ticket[] = [];
    for (const t of this.tickets.values()) if (t.machineId === m.spec.id) out.push(t);
    return out.sort((a, b) => a.s.since.localeCompare(b.s.since));
  }

  /** Whether a machine can take one more ticket. A bridge takes one per lane, so it needs to know which way the ticket would cross. */
  private canTake(m: Machine | null, dir?: number): boolean {
    if (!m) return false;
    if (m.spec.kind === 'belt') return !m.item;
    /* a departure takes one ticket; nothing on the floor goes into an arrival, which only receives from its departures */
    if (m.spec.kind === 'teleporter') return m.spec.role === 'departure' && !m.item;
    /* a ticket is born at a desk (see `transfer`): nothing on the floor goes into one */
    if (m.spec.kind === 'desk') return false;
    /* nor into an intake: it only receives from its source */
    if (m.spec.kind === 'intake') return false;
    if (m.spec.kind === 'bridge') return dir !== undefined && !(dir % 2 === 0 ? m.item : m.item2);   // 0 and 2 cross east-west
    if (m.spec.kind === 'station') {
      /* its places are for what it works on; what is done waits apart, and intake stops when that piles up as high */
      let busy = 0, done = 0;
      for (const t of this.inside(m)) { if (t.s.phase === 'out') done++; else if (!SET_ASIDE.includes(t.s.phase)) busy++; }
      return busy < m.spec.cap && done < m.spec.cap;
    }
    return m.spec.kind === 'zone' || m.spec.kind === 'exit';
  }

  private detach(t: Ticket): void {
    const m = t.machineId ? this.byId.get(t.machineId) : null;
    if (m && m.item === t) { m.item = null; if (m.spec.kind === 'arm') m.armState = 'back'; if (m.gate === 'failed') m.gate = 'idle'; }
    if (m && m.item2 === t) { m.item2 = null; if (m.spec.kind === 'belt') m.armState = 'back'; }
    t.machineId = null;
  }

  /** The only way a ticket changes place. */
  private accept(m: Machine, t: Ticket, fx?: number, fy?: number, p?: number): void {
    const spec = m.spec;
    t.machineId = spec.id; t.s.since = new Date(this.now()).toISOString(); t.s.released = false; t.s.runId = null; t.s.note = ''; t.s.x = spec.x; t.s.y = spec.y;
    this.dirty.add(t.ticketId);
    if (spec.kind === 'belt') { m.item = t; t.s.phase = 'belt'; t.s.p = p ?? 0.5; t.s.fx = fx ?? DX[spec.dir]; t.s.fy = fy ?? DY[spec.dir]; }
    else if (spec.kind === 'bridge') { t.s.phase = 'belt'; t.s.p = p ?? 0; t.s.fx = fx ?? 1; t.s.fy = fy ?? 0; if (t.s.fx !== 0) m.item = t; else m.item2 = t; }
    else if (spec.kind === 'teleporter') { m.item = t; t.s.phase = 'port'; t.s.p = 0; }
    else if (spec.kind === 'station') {
      t.s.outcome = '';
      if (spec.exec === 'human_gate') { t.s.phase = 'review'; this.openRun(spec, t, 'needs_review'); }
      else if (spec.exec === 'native') {
        t.s.phase = 'out'; t.s.outcome = spec.outcomes[0] ?? 'ok';
        if (spec.sets) this.applyStatus(t, spec.sets);
      } else t.s.phase = 'wait';
    } else if (spec.kind === 'zone') { t.s.phase = 'zone'; if (spec.status) this.applyStatus(t, spec.status); }
    /* a desk holds what was just created there, already free to go: the first arm that wants it takes it */
    else if (spec.kind === 'desk') { t.s.phase = 'zone'; t.s.released = true; }
    /* an intake holds an item until its conversation has been quiet long enough (`updateIntake`) */
    else if (spec.kind === 'intake') { t.s.phase = 'zone'; }
    else if (spec.kind === 'exit' && t.item) {
      /* an item is not shipped: it is archived, at the very least */
      this.archive(t, 'exit');
    }
    else if (spec.kind === 'exit') {
      this.applyStatus(t, 'done');
      /* a row for the shipment: from hand-over to exit, which is the lead time the stats report */
      this.saveRun({
        id: randomUUID(), ticketId: t.ticketId, floorId: this.floor.id, machineId: spec.id, machineName: spec.name || 'Exit', executor: 'exit',
        status: 'completed', outcome: 'shipped', executionId: null, error: null, startedAt: t.createdAt, finishedAt: t.s.since,
      });
      this.tickets.delete(t.ticketId); this.dirty.delete(t.ticketId);
      void this.deps.store.removeTicket(t.ticketId).catch((err) => this.deps.logger.warn('Factory: could not release a shipped ticket', { ticketId: t.ticketId, error: String(err) }));
    }
  }

  private applyStatus(t: Ticket, status: TicketStatus): void {
    /* an item has no status to set */
    if (t.item) return;
    if (t.info && t.info.status === status) return;
    if (t.info) t.info = { ...t.info, status };
    void this.deps.setStatus(t.ticketId, status).catch((err) => this.deps.logger.warn('Factory: could not set a ticket status', { ticketId: t.ticketId, status, error: String(err) }));
  }

  private openRun(spec: StationSpec, t: Ticket, status: FactoryRunRow['status']): FactoryRunRow {
    const run: FactoryRunRow = {
      id: randomUUID(), ticketId: t.ticketId, floorId: this.floor.id, machineId: spec.id, machineName: spec.name || 'Station', executor: spec.exec,
      status, outcome: null, executionId: null, error: null, startedAt: new Date(this.now()).toISOString(), finishedAt: null,
    };
    t.s.runId = run.id;
    this.saveRun(run);
    return run;
  }

  private saveRun(run: FactoryRunRow): void {
    /* a run row belongs to a ticket; an item's visits are not recorded */
    if (this.tickets.get(run.ticketId)?.item) return;
    void this.deps.store.saveRun(run).catch((err) => this.deps.logger.warn('Factory: could not save a run', { runId: run.id, error: String(err) }));
  }

  // ---------- arms ----------

  private matches(arm: ArmSpec, t: Ticket): boolean {
    return armMatches(arm, t.info, t.s.outcome);
  }

  /** An arm with no condition is the "otherwise" of its source: it leaves alone what a conditional neighbour is after. */
  private wants(arm: Machine, t: Ticket): boolean {
    const spec = arm.spec as ArmSpec;
    if (!this.matches(spec, t)) return false;
    if (isConditional(spec)) return true;
    for (const other of arm.src ? arm.src.takers : []) {
      const o = other.spec as ArmSpec;
      if (other !== arm && isConditional(o) && this.matches(o, t)) return false;
    }
    return true;
  }

  /** A ticket that is done in a station stays in view a moment before an arm takes it, however fast the station was. */
  private rested(t: Ticket): boolean { return this.restMs <= 0 || this.now() - Date.parse(t.s.since) >= this.restMs; }

  private pickFor(arm: Machine): Ticket | null {
    const s = arm.src, spec = arm.spec as ArmSpec;
    if (!s) {
      const x = spec.x - DX[spec.dir], y = spec.y - DY[spec.dir];
      for (const t of this.tickets.values()) if (t.s.phase === 'loose' && t.s.x === x && t.s.y === y && this.wants(arm, t)) return t;
      return null;
    }
    if (s.spec.kind === 'belt') return s.item && this.wants(arm, s.item) ? s.item : null;
    if (s.spec.kind === 'station') return this.inside(s).find((t) => ((t.s.phase === 'out' && this.rested(t)) || (t.s.phase === 'question' && takesQuestions(spec))) && this.wants(arm, t)) ?? null;
    if (s.spec.kind === 'zone' || s.spec.kind === 'desk' || s.spec.kind === 'intake') return this.inside(s).find((t) => t.s.released && this.wants(arm, t)) ?? null;
    /* out of an arrival only: what is in a departure is on its way somewhere else */
    if (s.spec.kind === 'teleporter') return s.spec.role === 'arrival' && s.item && this.ported(s.item) && this.wants(arm, s.item) ? s.item : null;
    return null;
  }

  private updateArm(a: Machine, dt: number): void {
    const spec = a.spec as ArmSpec, step = dt / this.armSwing;
    if (a.armState === 'carry' && a.item) {
      a.armP = Math.min(1, a.armP + step); a.item.s.p = a.armP;
      if (a.armP < 1) return;
      if (a.dst ? !this.canTake(a.dst, spec.dir) : false) return;
      const t = a.item; a.item = null; a.armState = 'back';
      /* dropped on a bridge, a ticket crosses it the way the arm points */
      if (a.dst?.spec.kind === 'bridge') this.accept(a.dst, t, DX[spec.dir], DY[spec.dir], 0.5);
      else if (a.dst) this.accept(a.dst, t);
      else { t.machineId = null; t.s.phase = 'loose'; t.s.x = spec.x + DX[spec.dir]; t.s.y = spec.y + DY[spec.dir]; this.dirty.add(t.ticketId); }
    } else if (a.armState === 'back' || (a.armState === 'carry' && !a.item)) { a.armP -= step; if (a.armP <= 0) { a.armP = 0; a.armState = 'rest'; } }
    else {
      if (a.dst && !this.canTake(a.dst, spec.dir)) return;
      const pick = this.pickFor(a);
      if (!pick) return;
      this.detach(pick);
      a.item = pick; a.armState = 'carry'; a.armP = 0;
      pick.machineId = spec.id; pick.s.phase = 'arm'; pick.s.p = 0; pick.s.x = spec.x; pick.s.y = spec.y;
      this.dirty.add(pick.ticketId);
    }
  }

  // ---------- belts ----------

  private updateBelt(b: Machine, dt: number): void {
    const t = b.item, spec = b.spec as BeltSpec;
    if (spec.toll) this.updateTollArm(b, spec.toll.out, dt);
    if (!t) return;
    /* under a gantry it stops in the middle of the tile until what the gantry changes is written on it */
    const gated = spec.set !== undefined && !this.underGantry(b, t);
    /* an arm that wants this ticket gets it: the belt holds it in the middle of the tile */
    /* a toll then tests it: what it rejects stays in the middle too, until the toll's arm is free to take it */
    const rejected = !!spec.toll && !gated && t.s.p <= 0.5 && spec.toll.when.some((c) => holds(c, t.info, t.s.outcome));
    const held = gated || rejected || b.takers.some((a) => this.wants(a, t));
    t.s.p = Math.min(t.s.p + BELT_SPEED * (spec.fast ? FAST_BELT : 1) * dt, held && t.s.p <= 0.5 ? 0.5 : 1);
    if (rejected && spec.toll) {
      if (t.s.p < 0.5 || b.armState !== 'rest') return;
      const dst = this.at(spec.x + DX[spec.toll.out], spec.y + DY[spec.toll.out]);
      if (dst && !this.canTake(dst, spec.toll.out)) return;             // nowhere to put it yet: it waits, and so does the line
      b.item = null; b.item2 = t; b.armState = 'carry'; b.armP = 0;
      t.s.phase = 'arm'; t.s.p = 0; this.dirty.add(t.ticketId);
      return;
    }
    if (t.s.p < 1) return;
    const n = this.at(spec.x + DX[spec.dir], spec.y + DY[spec.dir]);
    if (this.hand(n, t, DX[spec.dir], DY[spec.dir])) b.item = null;
  }

  /** The arm of a toll: it carries what was rejected from the middle of the belt to the tile beside it, then comes back. Shorter than an arm, so quicker. */
  private updateTollArm(b: Machine, out: 0 | 1 | 2 | 3, dt: number): void {
    const step = dt / (this.armSwing * 0.6);
    if (b.armState === 'carry' && b.item2) {
      b.armP = Math.min(1, b.armP + step); b.item2.s.p = b.armP;
      if (b.armP < 1) return;
      const dst = this.at(b.spec.x + DX[out], b.spec.y + DY[out]);
      if (dst && !this.canTake(dst, out)) return;
      const t = b.item2; b.item2 = null; b.armState = 'back';
      if (dst?.spec.kind === 'bridge') this.accept(dst, t, DX[out], DY[out], 0.5);
      else if (dst) this.accept(dst, t);
      else { t.machineId = null; t.s.phase = 'loose'; t.s.x = b.spec.x + DX[out]; t.s.y = b.spec.y + DY[out]; this.dirty.add(t.ticketId); }
    } else if (b.armState !== 'rest') { b.armP -= step; if (b.armP <= 0) { b.armP = 0; b.armState = 'rest'; } }
  }

  /** How long a gantry waits before it tries again to write what it could not. */
  private static readonly GATE_RETRY_MS = 5000;

  /**
   * A ticket under a Set gantry. Returns true once the gantry is done with it. What the gantry changes is applied
   * to the engine's own copy and written on the ticket; the ticket only goes on once that write is confirmed, and
   * what the engine knows of it is then read again, so that whatever looks at the ticket next (an arm, a toll) sees
   * what was written and nothing older. `released` marks a ticket the gantry has already dealt with: a restart of
   * the server does not count it twice.
   */
  private underGantry(b: Machine, t: Ticket): boolean {
    if (t.s.released) return true;
    if (t.s.p < 0.5 || b.gate === 'writing') return false;
    if (b.gate === 'failed' && this.now() < b.gateRetryAt) return false;
    const done = () => { b.gate = 'idle'; t.s.released = true; if (t.s.note) t.s.note = ''; this.dirty.add(t.ticketId); };
    const spec = b.spec as BeltSpec, ops = spec.set ?? [];
    /* what a gantry sets are a ticket's fields: an item goes under it untouched */
    if (!t.info || !ops.length || t.item) { done(); return true; }
    const before = t.info, { info, change } = applyOps(before, ops);
    if (!change) { done(); return true; }
    if (!this.deps.applyChange) { t.info = info; done(); return true; }
    b.gate = 'writing'; t.info = info;
    const here = () => b.item === t && this.tickets.get(t.ticketId) === t;
    void this.deps.applyChange(t.ticketId, change)
      .then(async () => { const fresh = await this.deps.loadTicket(t.ticketId).catch(() => null); if (fresh) t.info = fresh; if (here()) done(); else b.gate = 'idle'; })
      .catch((err) => {
        /* nothing was written: what the engine knows goes back to what it was, and the gantry tries again in a moment */
        if (t.info === info) t.info = before;
        if (!here()) { b.gate = 'idle'; return; }
        b.gate = 'failed'; b.gateRetryAt = this.now() + FactoryEngine.GATE_RETRY_MS;
        t.s.note = 'The gantry could not write on the ticket: it tries again'; this.dirty.add(t.ticketId);
        this.deps.logger.warn('Factory: a gantry could not write on a ticket', { ticketId: t.ticketId, error: err instanceof Error ? err.message : String(err) });
      });
    return false;
  }

  /** Pass a ticket travelling in a direction to the next tile, if that tile can take it now. */
  private hand(n: Machine | null, t: Ticket, fx: number, fy: number): boolean {
    if (!n) return false;
    if (n.spec.kind === 'belt') { if (n.item) return false; this.accept(n, t, fx, fy, 0); return true; }
    if (n.spec.kind === 'bridge') { if (fx !== 0 ? n.item : n.item2) return false; this.accept(n, t, fx, fy, 0); return true; }
    if ((isBox(n) || n.spec.kind === 'teleporter') && this.canTake(n)) { this.accept(n, t); return true; }
    return false;
  }

  /**
   * Whether the lane of a bridge that a ticket crosses in a direction is a fast one. A bridge has no speed of its own:
   * a lane goes at the speed of the belt that feeds it, the one before the run of bridges the ticket is crossing; fed
   * by an arm (no belt before it), at the speed of the belt it leads to.
   */
  private fastLane(m: Machine, fx: number, fy: number): boolean {
    const end = (sx: number, sy: number): Machine | null => {
      let x = m.spec.x + sx, y = m.spec.y + sy, n = this.at(x, y), guard = 0;
      while (n && n.spec.kind === 'bridge' && guard++ < 2000) { x += sx; y += sy; n = this.at(x, y); }
      return n;
    };
    const along = (n: Machine | null): BeltSpec | null => (n && n.spec.kind === 'belt' && DX[n.spec.dir] === fx && DY[n.spec.dir] === fy ? n.spec : null);
    const before = along(end(-fx, -fy));
    return before ? before.fast === true : along(end(fx, fy))?.fast === true;
  }

  /** A bridge carries each of its two tickets straight across, whatever the other lane does. */
  private updateBridge(m: Machine, dt: number): void {
    for (const lane of ['item', 'item2'] as const) {
      const t = m[lane];
      if (!t) continue;
      t.s.p = Math.min(1, t.s.p + BELT_SPEED * (this.fastLane(m, t.s.fx, t.s.fy) ? FAST_BELT : 1) * dt);
      if (t.s.p < 1) continue;
      const { fx, fy } = t.s;
      m[lane] = null;
      if (!this.hand(this.at(m.spec.x + fx, m.spec.y + fy), t, fx, fy)) m[lane] = t;
    }
  }

  // ---------- stations and zones ----------

  private runningCount(): number { let n = 0; for (const t of this.tickets.values()) if (t.s.phase === 'running') n++; return n; }

  private runsLastHour(): number {
    const cutoff = this.now() - HOUR_MS;
    while (this.runStarts.length && this.runStarts[0]! < cutoff) this.runStarts.shift();
    return this.runStarts.length;
  }

  private updateStation(m: Machine): void {
    const spec = m.spec as StationSpec;
    if (spec.exec === 'human_gate' || spec.exec === 'native') return;
    const inside = this.inside(m);
    let running = inside.filter((t) => t.s.phase === 'running').length;
    for (const t of inside) {
      if (t.s.phase !== 'wait') continue;
      if (t.item) { t.s.phase = 'failed'; t.s.note = 'Stations do not work on items yet: move it, or archive it'; this.dirty.add(t.ticketId); continue; }
      const s = this.floor.settings;
      const note = spec.off ? `${spec.name || 'The station'} is switched off`
        : running >= spec.cap ? `${spec.name || 'The station'} works on ${spec.cap} at once`
        : this.runsLastHour() >= s.maxRunsPerHour ? `Limit of ${s.maxRunsPerHour} runs per hour reached: the Factory waits`
        : this.runningCount() >= s.maxConcurrentRuns ? `${s.maxConcurrentRuns} Factory runs already in flight` : '';
      if (note) { if (t.s.note !== note) { t.s.note = note; this.dirty.add(t.ticketId); } continue; }
      this.startRun(m, t); running++;
    }
  }

  private startRun(m: Machine, t: Ticket): void {
    const spec = m.spec as StationSpec;
    t.s.phase = 'running'; t.s.note = ''; this.dirty.add(t.ticketId);
    this.runStarts.push(this.now());
    const run = this.openRun(spec, t, 'running');
    this.openRuns.set(run.id, run);
    /* where each outcome leads, so the agent is told what its answer does */
    const targets: Record<string, string> = {};
    for (const o of spec.outcomes) {
      const arm = m.takers.find((a) => acceptsOutcome(a.spec as ArmSpec, o)) ?? m.takers.find((a) => !isConditional(a.spec as ArmSpec));
      const dest = arm ? this.leadsTo(arm.dst, (arm.spec as ArmSpec).dir) : null;
      targets[o] = dest?.spec.name || (dest ? dest.spec.kind : 'nowhere yet');
    }
    void this.deps.runner.run(spec, t.ticketId, run.id, targets, (executionId) => { run.executionId = executionId; this.saveRun(run); })
      .then((res) => {
        this.openRuns.delete(run.id);
        run.finishedAt = new Date(this.now()).toISOString(); run.executionId = res.executionId ?? run.executionId; run.error = res.error;
        const still = this.tickets.get(t.ticketId) === t && t.machineId === spec.id && t.s.runId === run.id;
        if (!still) { run.status = res.status === 'failed' ? 'failed' : 'interrupted'; this.saveRun(run); return; }
        if (res.status === 'completed') { run.status = 'completed'; run.outcome = res.outcome; t.s.phase = 'out'; t.s.outcome = res.outcome; t.s.since = run.finishedAt; }
        else if (res.status === 'question') { run.status = 'question'; t.s.phase = 'question'; t.s.outcome = QUESTION_OUTCOME; t.s.note = 'The agent asked a question in the ticket thread'; }
        else { run.status = 'failed'; t.s.phase = 'failed'; t.s.note = res.error ?? 'The run failed'; }
        this.saveRun(run); this.dirty.add(t.ticketId);
      })
      .catch((err) => {
        this.openRuns.delete(run.id);
        run.status = 'failed'; run.error = err instanceof Error ? err.message : String(err); run.finishedAt = new Date(this.now()).toISOString(); this.saveRun(run);
        if (this.tickets.get(t.ticketId) === t && t.s.runId === run.id) { t.s.phase = 'failed'; t.s.note = run.error; this.dirty.add(t.ticketId); }
      });
  }

  /** The first machine a belt leads to, following the belts as they point. */
  private leadsTo(m: Machine | null, dir: number = 0): Machine | null {
    let guard = 0;
    while (m && (m.spec.kind === 'belt' || m.spec.kind === 'bridge') && guard++ < 5000) {
      if (m.spec.kind === 'belt') dir = m.spec.dir;
      m = this.at(m.spec.x + DX[dir as 0], m.spec.y + DY[dir as 0]);
    }
    return m && m.spec.kind !== 'belt' && m.spec.kind !== 'bridge' ? m : null;
  }

  private updateZone(m: Machine): void {
    const spec = m.spec as ZoneSpec;
    if (spec.release !== 'auto') return;
    const inside = this.inside(m);
    if (inside.some((t) => t.s.released)) return;       // one at a time: the arm takes it, then the next one is let out
    const next = inside[0];
    if (!next) return;
    if (spec.status === 'todo') {
      let wip = 0;
      for (const t of this.tickets.values()) if (t.info && (t.info.status === 'doing' || t.info.status === 'reviewing')) wip++;
      if (wip >= (spec.limit ?? 12)) return;
    }
    next.s.released = true; this.dirty.add(next.ticketId);
  }

  /** An intake lets out the items whose conversation has been quiet for its delay. */
  private updateIntake(m: Machine): void {
    const quiet = ((m.spec as IntakeSpec).quietSec ?? DEFAULT_QUIET_SEC) * 1000, now = this.now();
    for (const t of this.inside(m)) {
      if (t.s.released || !t.item) continue;
      if (now - Date.parse(t.item.lastActivityAt) >= quiet) { t.s.released = true; this.dirty.add(t.ticketId); }
    }
  }

  // ---------- teleporters ----------

  /** A ticket in a teleporter stays in view a moment before it is sent on, or taken out. */
  private ported(t: Ticket): boolean { return this.portMs <= 0 || this.now() - Date.parse(t.s.since) >= this.portMs; }

  /**
   * Send what waits in the departures: to each arrival that is free, the ticket that has waited longest among the
   * departures that lead to it. The others stay where they are until an arm has emptied the arrival.
   */
  private updateTeleporters(): void {
    const next = new Map<Machine, Machine>();
    for (const d of this.machines) {
      if (d.spec.kind !== 'teleporter' || d.spec.role !== 'departure' || !d.item || !d.spec.to || !this.ported(d.item)) continue;
      const a = this.byId.get(d.spec.to);
      if (!a || a.spec.kind !== 'teleporter' || a.spec.role !== 'arrival' || a.item) continue;
      const first = next.get(a);
      if (!first || d.item.s.since < first.item!.s.since) next.set(a, d);
    }
    for (const [a, d] of next) { const t = d.item!; d.item = null; this.accept(a, t); }
  }

  // ---------- the tick ----------

  tick(dt: number): void {
    if (this.floor.settings.halted) return;
    for (const m of this.machines) {
      const k = m.spec.kind;
      if (k === 'belt') this.updateBelt(m, dt);
      else if (k === 'bridge') this.updateBridge(m, dt);
      else if (k === 'arm') this.updateArm(m, dt);
      else if (k === 'station') this.updateStation(m);
      else if (k === 'zone') this.updateZone(m);
      else if (k === 'intake') this.updateIntake(m);
    }
    this.updateTeleporters();
  }

  /** Write what moved since the last time. One write at a time: a slow database never gets two in flight. */
  async flush(): Promise<void> {
    while (this.flushing) await this.flushing;
    this.flushing = this.flushNow().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async flushNow(): Promise<void> {
    const ids = [...this.dirty]; this.dirty.clear();
    const nowIso = new Date(this.now()).toISOString();
    for (const id of ids) {
      const t = this.tickets.get(id);
      if (!t) continue;
      if (t.item) {
        t.item = { ...t.item, machineId: t.machineId, state: t.s, updatedAt: nowIso };
        try { await this.deps.store.saveItem(t.item); }
        catch (err) { this.dirty.add(id); this.deps.logger.warn('Factory: could not save an item', { itemId: id, error: String(err) }); }
        continue;
      }
      try { await this.deps.store.saveTicket({ ticketId: t.ticketId, floorId: this.floor.id, machineId: t.machineId, state: t.s, createdAt: t.createdAt, updatedAt: nowIso }); }
      catch (err) { this.dirty.add(id); this.deps.logger.warn('Factory: could not save a ticket position', { ticketId: id, error: String(err) }); }
    }
  }

  /** Re-read type, priority, status and tags; a ticket that was deleted or archived leaves the floor. */
  /** A sweep still running is waited for, never doubled: on a slow database sweeps would otherwise pile up. */
  refreshInfos(): Promise<void> {
    if (!this.sweeping) this.sweeping = this.sweep().finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  private async sweep(): Promise<void> {
    const all = [...this.tickets.values()].filter((t) => !t.item);
    for (let i = 0; i < all.length; i += REFRESH_CONCURRENCY) await Promise.all(all.slice(i, i + REFRESH_CONCURRENCY).map((t) => this.reread(t)));
  }

  private async reread(t: Ticket): Promise<void> {
    try {
      const info = await this.deps.loadTicket(t.ticketId);
      if (info) t.info = info;
      else if (this.tickets.get(t.ticketId) === t) { this.detach(t); this.tickets.delete(t.ticketId); this.dirty.delete(t.ticketId); await this.deps.store.removeTicket(t.ticketId); }
    } catch (err) { this.deps.logger.warn('Factory: could not refresh a ticket', { ticketId: t.ticketId, error: String(err) }); }
  }

  /** A ticket on the floor was changed elsewhere in Fleex: re-read it now. Nothing happens for a ticket that is not on the floor. */
  async ticketChanged(ticketId: string): Promise<void> {
    const t = this.tickets.get(ticketId);
    if (t) await this.reread(t);
  }

  /** Re-read one ticket now, after it was changed from the Factory page (a favourite toggled), without waiting for the next sweep. */
  async refreshInfo(ticketId: string): Promise<void> {
    const t = this.get(ticketId);
    if (t.item) return;
    const info = await this.deps.loadTicket(ticketId);
    if (info) t.info = info;
  }

  // ---------- what a human does ----------

  private get(ticketId: string): Ticket {
    const t = this.tickets.get(ticketId);
    if (!t) throw new FactoryError('This ticket is not on the factory floor');
    return t;
  }

  /** The tickets on the floor; items are not tickets, and are left out. */
  managedIds(): Set<string> { return new Set([...this.tickets.values()].filter((t) => !t.item).map((t) => t.ticketId)); }
  isManaged(ticketId: string): boolean { return this.tickets.has(ticketId); }

  /** The Inbound zone, created on the first free spot when the floor has none (it was removed, or the floor predates it). */
  private async ensureInbound(): Promise<string> {
    const existing = this.machines.find((m) => m.spec.kind === 'zone' && m.spec.inbound);
    if (existing) return existing.spec.id;
    /* to the left of what is built, where nothing can be in the way */
    let x = 1, y = 1;
    for (const m of this.machines) { x = Math.min(x, m.spec.x - 6); y = Math.min(y, m.spec.y); }
    const zone = inboundZone(x, y);
    await this.setLayout({ ...this.floor.layout, machines: [...this.floor.layout.machines, zone] });
    return zone.id;
  }

  /**
   * Hand a ticket over to the Factory. With no target it lands in the Inbound zone, where it waits
   * to be dragged onto the floor; otherwise on the machine or the tile that was asked for. A desk takes a ticket only
   * this way: the one that was just created at it.
   */
  async transfer(ticketId: string, target: { machineId?: string; x?: number; y?: number } = {}): Promise<void> {
    if (this.tickets.has(ticketId)) throw new FactoryError('This ticket is already on the factory floor');
    const info = await this.deps.loadTicket(ticketId);
    if (!info) throw new FactoryError('Ticket not found, or archived');
    if (!target.machineId && (target.x == null || target.y == null)) target = { machineId: await this.ensureInbound() };
    const nowIso = new Date(this.now()).toISOString();
    const t: Ticket = {
      ticketId, machineId: null, createdAt: nowIso, info,
      s: { x: 0, y: 0, phase: 'loose', p: 0, fx: 1, fy: 0, outcome: '', released: false, since: nowIso, runId: null, note: '' },
    };
    const desk = target.machineId ? this.byId.get(target.machineId) : undefined;
    if (desk?.spec.kind === 'desk') { this.tickets.set(ticketId, t); this.accept(desk, t); await this.flush(); return; }
    this.tickets.set(ticketId, t);
    this.place(t, target);
    await this.flush();
  }

  private place(t: Ticket, target: { machineId?: string; x?: number; y?: number }): void {
    const m = target.machineId ? this.byId.get(target.machineId) ?? null : target.x != null && target.y != null ? this.at(Math.floor(target.x), Math.floor(target.y)) : null;
    if (target.machineId && !m) throw new FactoryError('Unknown machine');
    if (m && !this.canTake(m)) throw new FactoryError(m.spec.kind === 'belt' ? 'This belt tile is taken' : m.spec.kind === 'station' ? `${m.spec.name || 'This station'} is full` : m.spec.kind === 'bridge' ? 'A ticket cannot be dropped on a bridge: put it on the belt before it' : m.spec.kind === 'teleporter' ? (m.spec.role === 'arrival' ? 'Nothing can be dropped on an arrival: tickets come to it from its departures' : 'This teleporter already holds a ticket') : m.spec.kind === 'desk' ? 'A desk only holds the tickets created at it' : 'A ticket cannot be dropped on this machine');
    this.detach(t);
    if (m) { this.accept(m, t); return; }
    t.s.phase = 'loose'; t.s.x = Math.floor(target.x ?? 0); t.s.y = Math.floor(target.y ?? 0);
    t.s.since = new Date(this.now()).toISOString(); t.s.runId = null; t.s.note = ''; t.s.released = false;
    this.dirty.add(t.ticketId);
  }

  /** Move a ticket by hand. A run in progress keeps going but its result is ignored. */
  async move(ticketId: string, target: { machineId?: string; x?: number; y?: number }): Promise<void> { this.place(this.get(ticketId), target); await this.flush(); }

  /** Take a ticket back out of the Factory: plain Fleex owns it again, in the status it has now. */
  async giveBack(ticketId: string): Promise<void> {
    const t = this.get(ticketId);
    /* an item has nowhere to go back to: giving it back is archiving it */
    if (t.item) { await this.archiveItem(ticketId); return; }
    this.detach(t); this.tickets.delete(ticketId); this.dirty.delete(ticketId);
    await this.deps.store.removeTicket(ticketId);
  }

  private looseState(): FactoryTicketState {
    const nowIso = new Date(this.now()).toISOString();
    return { x: 0, y: 0, phase: 'loose', p: 0, fx: 1, fy: 0, outcome: '', released: false, since: nowIso, runId: null, note: '' };
  }

  /** Take an item off the floor and archive it (soft delete): by hand as junk, or at an exit. */
  private archive(t: Ticket, reason: 'junk' | 'exit'): void {
    const row = t.item!, nowIso = new Date(this.now()).toISOString();
    this.detach(t); this.tickets.delete(t.ticketId); this.dirty.delete(t.ticketId); this.itemKeys.delete(`${row.source}\u0000${row.sourceKey}`);
    const archived: FactoryItemRow = { ...row, machineId: null, state: null, archivedAt: nowIso, archivedReason: reason, updatedAt: nowIso };
    void this.deps.store.saveItem(archived).catch((err) => this.deps.logger.warn('Factory: could not archive an item', { itemId: row.id, error: String(err) }));
  }

  /** Archive an item by hand: it is junk, or done with. A new message in its conversation brings it back. */
  async archiveItem(itemId: string): Promise<void> {
    const t = this.get(itemId);
    if (!t.item) throw new FactoryError('Only an item can be archived from the floor: a ticket is given back');
    this.archive(t, 'junk');
    await this.flush();
  }

  /**
   * A source says a conversation moved: a new one, or a new message on one already known. A new one is dropped when a
   * rule of its intake recognises it (it never reaches the floor, the intake counts it), and comes in otherwise. A new
   * message updates the item where it is; in its intake, the item waits for the conversation to be quiet again. An
   * archived item comes back to its intake.
   */
  async ingest(input: ItemInput): Promise<{ itemId: string | null; status: 'new' | 'updated' | 'back' | 'dropped' }> {
    if (!input || !ITEM_SOURCES.includes(input.source)) throw new FactoryError(`unknown item source "${String(input?.source)}"`);
    const key = String(input.key ?? '').trim().slice(0, 500);
    if (!key) throw new FactoryError('an item needs its key in its source');
    const intake = this.machines.find((m) => m.spec.kind === 'intake' && m.spec.source === input.source);
    if (!intake) throw new FactoryError(`No ${input.source} intake on the floor: put one there first (Build › Area › Intake)`);
    const nowIso = new Date(this.now()).toISOString();
    const url = typeof input.url === 'string' && /^https?:\/\//.test(input.url) ? input.url.slice(0, 2000) : null;
    const fields = {
      title: String(input.title ?? '').trim().slice(0, 300) || '(no subject)',
      author: String(input.author ?? '').trim().slice(0, 200),
      excerpt: String(input.excerpt ?? '').trim().slice(0, 2000),
      tags: (Array.isArray(input.tags) ? input.tags : []).map(String).map((t) => t.trim()).filter(Boolean).slice(0, 20),
    };
    const count = (was: number) => Math.max(1, Math.floor(Number(input.messages) || was + 1));

    const onFloor = this.itemKeys.get(`${input.source}\u0000${key}`), known = onFloor ? this.tickets.get(onFloor) : undefined;
    if (known?.item) {
      known.item = { ...known.item, ...fields, url: url ?? known.item.url, messages: count(known.item.messages), lastActivityAt: nowIso };
      known.info = itemInfo(known.item);
      /* still in its intake: the conversation moves, so it waits for it to be quiet again */
      if (known.machineId && this.byId.get(known.machineId)?.spec.kind === 'intake') known.s.released = false;
      this.dirty.add(known.ticketId);
      await this.flush();
      return { itemId: known.ticketId, status: 'updated' };
    }

    const stored = await this.deps.store.getItemByKey(input.source, key);
    const row: FactoryItemRow = {
      id: stored?.id ?? randomUUID(), floorId: this.floor.id, source: input.source, sourceKey: key, ...fields, url: url ?? stored?.url ?? null,
      messages: stored ? count(stored.messages) : Math.max(1, Math.floor(Number(input.messages) || 1)), lastActivityAt: nowIso,
      intakeId: intake.spec.id, machineId: null, state: null, archivedAt: null, archivedReason: null, createdAt: stored?.createdAt ?? nowIso, updatedAt: nowIso,
    };
    /* what was archived by hand or at an exit comes back; what was dropped, and anything new, goes through the rules */
    const back = !!stored && stored.archivedReason !== 'dropped';
    if (!back && dropsIt((intake.spec as IntakeSpec).drop, row)) {
      await this.deps.store.saveItem({ ...row, archivedAt: nowIso, archivedReason: 'dropped' });
      this.dropped.set(intake.spec.id, (this.dropped.get(intake.spec.id) ?? 0) + 1);
      return { itemId: null, status: 'dropped' };
    }
    const t: Ticket = { ticketId: row.id, machineId: null, s: this.looseState(), createdAt: row.createdAt, info: itemInfo(row), item: row };
    this.tickets.set(t.ticketId, t); this.itemKeys.set(`${row.source}\u0000${key}`, row.id);
    this.accept(intake, t);
    await this.flush();
    return { itemId: row.id, status: back ? 'back' : 'new' };
  }

  async release(ticketId: string): Promise<void> {
    const t = this.get(ticketId);
    if (t.s.phase !== 'zone') throw new FactoryError('Only a ticket waiting in a zone can be released');
    t.s.released = true; this.dirty.add(ticketId);
    await this.flush();
  }

  /** A human decides at a gate: the ticket leaves by the arm that takes this outcome. The decision, and the reason given for it, go in the ticket's thread. */
  async resolveGate(ticketId: string, outcome: string, reason = ''): Promise<void> {
    const t = this.get(ticketId), m = t.machineId ? this.byId.get(t.machineId) : null;
    if (!m || m.spec.kind !== 'station' || t.s.phase !== 'review') throw new FactoryError('This ticket is not waiting at a gate');
    if (!m.spec.outcomes.includes(outcome)) throw new FactoryError(`"${outcome}" is not an outcome of ${m.spec.name || 'this gate'}`);
    const nowIso = new Date(this.now()).toISOString();
    if (t.s.runId) this.saveRun({
      id: t.s.runId, ticketId, floorId: this.floor.id, machineId: m.spec.id, machineName: m.spec.name || 'Gate', executor: 'human_gate',
      status: 'completed', outcome, executionId: null, error: null, startedAt: t.s.since, finishedAt: nowIso,
    });
    t.s.phase = 'out'; t.s.outcome = outcome; t.s.since = nowIso; this.dirty.add(ticketId);
    if (this.deps.recordDecision && !t.item) void this.deps.recordDecision(ticketId, m.spec.name || 'Gate', outcome, reason.trim().slice(0, 4000))
      .catch((err) => this.deps.logger.warn('Factory: could not write a decision in the thread', { ticketId, error: String(err) }));
    await this.flush();
  }

  /** The station a ticket is in, when that station runs something (an agent, a skill, a panel). */
  private runningStation(t: Ticket): (Machine & { spec: StationSpec }) | null {
    const m = t.machineId ? this.byId.get(t.machineId) : null;
    return m && m.spec.kind === 'station' && RUNS.includes(m.spec.exec) ? (m as Machine & { spec: StationSpec }) : null;
  }

  /**
   * A human takes a ticket off its station's hands: it stays in the station, set aside, and frees its place. A run in
   * progress is stopped. Nothing happens to it until it is put back.
   */
  async setAside(ticketId: string, why = ''): Promise<void> {
    const t = this.get(ticketId), m = this.runningStation(t);
    if (!m || !['wait', 'running', 'out'].includes(t.s.phase)) throw new FactoryError('Only a ticket a station is working on can be set aside');
    const nowIso = new Date(this.now()).toISOString(), run = t.s.phase === 'running' && t.s.runId ? this.openRuns.get(t.s.runId) : null;
    if (run) {
      run.status = 'interrupted'; run.finishedAt = nowIso; this.saveRun(run);
      if (run.executionId && this.deps.cancelExecution) void this.deps.cancelExecution(run.executionId)
        .catch((err) => this.deps.logger.warn('Factory: could not stop a run', { ticketId, error: String(err) }));
    }
    t.s.note = [t.s.phase === 'running' ? `You stopped ${m.spec.name || 'the station'}'s run` : '', why].filter(Boolean).join(': ');
    t.s.phase = 'aside'; t.s.outcome = ''; t.s.runId = null; t.s.since = nowIso; this.dirty.add(ticketId);
    await this.flush();
  }

  /**
   * Put back a ticket that was set aside (a question, a failed run, or one a human took): `again` gives it back to the
   * station, which runs on it again with what is now in the thread; `as` sends it out by the arm of that outcome, as if
   * the station had concluded it. Sending it to another machine is a move, as for any ticket.
   */
  async putBack(ticketId: string, how: 'again' | 'as', outcome = ''): Promise<void> {
    const t = this.get(ticketId), m = this.runningStation(t);
    if (!m || !SET_ASIDE.includes(t.s.phase)) throw new FactoryError('This ticket is not set aside in a station');
    if (how === 'as') {
      if (!m.spec.outcomes.includes(outcome)) throw new FactoryError(`"${outcome}" is not an outcome of ${m.spec.name || 'this station'}`);
      t.s.phase = 'out'; t.s.outcome = outcome; t.s.since = new Date(this.now()).toISOString();
    } else { t.s.phase = 'wait'; t.s.outcome = ''; }
    t.s.note = ''; t.s.runId = null; this.dirty.add(ticketId);
    await this.flush();
  }

  /**
   * Someone launched an agent, a skill or a panel on this ticket by hand. A station working on it lets go: its own run
   * is stopped and the ticket waits, set aside, for that person to put it back or send it out. Anywhere else on the
   * floor nothing changes. True when the ticket was set aside.
   */
  async launchedByHand(ticketId: string): Promise<boolean> {
    const t = this.tickets.get(ticketId);
    if (!t || !this.runningStation(t) || !['wait', 'running', 'out'].includes(t.s.phase)) return false;
    await this.setAside(ticketId, 'you launched something on this ticket by hand');
    return true;
  }

  /**
   * Someone wrote in the thread of a ticket whose station had asked a question: that is the answer, and the station
   * runs on it again. True when the ticket was put back.
   */
  async answered(ticketId: string): Promise<boolean> {
    const t = this.tickets.get(ticketId);
    if (!t || t.s.phase !== 'question' || !this.runningStation(t)) return false;
    await this.putBack(ticketId, 'again');
    return true;
  }

  /** Run the station again: after a failure, or once a question has been answered in the ticket thread. */
  retry(ticketId: string): Promise<void> { return this.putBack(ticketId, 'again'); }

  /** Switch a station on or off. Off, it takes tickets in but starts nothing on them; what already runs finishes. */
  async setPower(machineId: string, on: boolean): Promise<void> {
    const m = this.byId.get(machineId);
    if (!m || m.spec.kind !== 'station' || !RUNS.includes(m.spec.exec)) throw new FactoryError('Only a station that runs something has a switch');
    if (on) delete m.spec.off; else m.spec.off = true;
    for (const t of this.inside(m)) if (t.s.phase === 'wait' && t.s.note) { t.s.note = ''; this.dirty.add(t.ticketId); }
    this.floor = { ...this.floor, layout: { ...this.floor.layout }, updatedAt: new Date(this.now()).toISOString() };
    await this.deps.store.saveFloor(this.floor);
    await this.flush();
  }

  get halted(): boolean { return this.floor.settings.halted === true; }

  /**
   * The emergency stop. On: belts, arms, zones and teleporters stop where they are, no station starts anything, and
   * every run in progress is cut at once; its ticket stays in its place, to be run again. Off: the floor carries on
   * from where it stood, and those tickets start over. People can still move tickets by hand and decide at gates
   * while it is on: what they decide waits with the rest. It is kept across restarts.
   */
  async setHalted(on: boolean): Promise<void> {
    const nowIso = new Date(this.now()).toISOString();
    if (on) for (const t of this.tickets.values()) {
      if (t.s.phase !== 'running') continue;
      const run = t.s.runId ? this.openRuns.get(t.s.runId) : null;
      if (run) {
        run.status = 'interrupted'; run.finishedAt = nowIso; run.error = 'Cut by the emergency stop'; this.saveRun(run);
        if (run.executionId && this.deps.cancelExecution) void this.deps.cancelExecution(run.executionId)
          .catch((err) => this.deps.logger.warn('Factory: could not stop a run', { ticketId: t.ticketId, error: String(err) }));
      }
      /* back in line in its station: the result of the run that was cut is ignored (its run id no longer matches) */
      t.s.phase = 'wait'; t.s.runId = null; t.s.note = 'Cut by the emergency stop: it runs again when the floor restarts'; this.dirty.add(t.ticketId);
    }
    const settings = { ...this.floor.settings };
    if (on) settings.halted = true; else delete settings.halted;
    this.floor = { ...this.floor, settings, updatedAt: nowIso };
    this.deps.logger.info(on ? 'Factory: emergency stop' : 'Factory: restarted after an emergency stop');
    await this.deps.store.saveFloor(this.floor);
    await this.flush();
  }

  /** The page has shown the notice. */
  ackNotice(): void { this.notice = null; }

  snapshot(): FactorySnapshot {
    return {
      notice: this.notice,
      floor: { id: this.floor.id, name: this.floor.name, layout: this.floor.layout, settings: this.floor.settings },
      tickets: [...this.tickets.values()].map((t) => ({ ticketId: t.ticketId, machineId: t.machineId, info: t.info, handedAt: t.createdAt, ...t.s, ...(t.item ? { item: itemOf(t.item) } : {}) })),
      intakes: Object.fromEntries(this.machines.filter((m) => m.spec.kind === 'intake').map((m) => [m.spec.id, { dropped: this.dropped.get(m.spec.id) ?? 0 }])),
      /* arms, and the arms of tolls, which go by their belt's id */
      arms: this.machines.filter((m) => m.spec.kind === 'arm' || (m.spec.kind === 'belt' && !!m.spec.toll)).map((m) => ({ id: m.spec.id, p: m.armP, state: m.armState, carrying: (m.spec.kind === 'arm' ? m.item : m.item2)?.ticketId ?? null })),
      armSwing: this.armSwing, beltSpeed: BELT_SPEED, fastBelt: FAST_BELT,
      runsLastHour: this.runsLastHour(), running: this.runningCount(), serverTime: new Date(this.now()).toISOString(),
    };
  }
}
