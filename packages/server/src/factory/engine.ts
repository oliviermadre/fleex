import { randomUUID } from 'node:crypto';
import { LAYOUT_VERSION, upgradeLayout } from './layout-versions.js';
import type { TicketStatus } from '@fleex/shared';
import type { FactoryStorePort } from './factory-store.port.js';
import type { StationRunnerPort } from './station-runner.js';
import { acceptsOutcome, isConditional, matches as armMatches, normaliseConditions, QUESTION_OUTCOME, takesQuestions } from './conditions.js';
import {
  DEFAULT_FLOOR_ID, DEFAULT_SETTINGS, DX, DY, RUNS, SET_ASIDE,
  type ArmSpec, type BeltSpec, type FactoryFloorRow, type FactoryLayout, type FactoryRunRow, type FactorySettings,
  type FactoryTicketInfo, type FactoryTicketState, type MachineSpec, type StationSpec, type ZoneSpec,
} from './types.js';

/** Tiles per second on a belt. */
const BELT_SPEED = 1.2;
/** How many times faster a fast belt carries a ticket. */
export const FAST_BELT = 2;
/** Seconds for an arm to swing one way: slow enough for the half turn to be watched. */
const ARM_SWING = 1.1;
/** How long a ticket rests in a station once it is done there, before an arm may take it: long enough to be seen. */
const STATION_REST_MS = 1000;
const FLUSH_EVERY_MS = 2000;
const REFRESH_INFO_EVERY_MS = 10_000;
const HOUR_MS = 3_600_000;

interface Machine {
  spec: MachineSpec;
  /** Arms that take from this machine. */
  takers: Machine[];
  src: Machine | null;
  dst: Machine | null;
  /** Belts: the ticket on the tile. Arms: the ticket in the gripper. Bridges: the ticket travelling east-west. */
  item: Ticket | null;
  /** Bridges: the ticket travelling north-south. */
  item2: Ticket | null;
  armState: 'rest' | 'carry' | 'back';
  armP: number;
}
interface Ticket {
  ticketId: string;
  machineId: string | null;
  s: FactoryTicketState;
  createdAt: string;
  info: FactoryTicketInfo | null;
}

export interface FactorySnapshot {
  floor: { id: string; name: string; layout: FactoryLayout; settings: FactorySettings };
  tickets: (FactoryTicketState & { ticketId: string; machineId: string | null; info: FactoryTicketInfo | null; /** When it was handed over to the Factory (ISO). */ handedAt: string })[];
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
  logger: { warn(msg: string, meta?: Record<string, unknown>): void; info(msg: string, meta?: Record<string, unknown>): void };
  now?: () => number;
  /** Stop the agent execution a run started: a human took the ticket off the station while it ran. */
  cancelExecution?(executionId: string): Promise<unknown>;
  /** Write a gate decision in the ticket's thread, in the human's name. */
  recordDecision?(ticketId: string, gate: string, outcome: string, reason: string): Promise<void>;
  /** Paces of the floor, for tests that do not want to wait for them. */
  timing?: { armSwing?: number; stationRestMs?: number };
}

export class FactoryError extends Error {}

/** The zone a handed-over ticket lands in: it sets no status and keeps tickets until they are moved or released. */
function inboundZone(x: number, y: number): ZoneSpec {
  return { id: randomUUID(), kind: 'zone', x, y, w: 4, h: 6, name: 'Inbound', status: '', release: 'manual', inbound: true };
}

/*
 * `question` is the outcome a run gets when the agent asks instead of answering. Only an arm that asks for it takes
 * such a ticket out of its station: any other arm leaves it there, so an unanswered ticket never carries on down the
 * normal path.
 */
export { QUESTION_OUTCOME };
function isBox(m: Machine | null): boolean { return !!m && (m.spec.kind === 'station' || m.spec.kind === 'zone' || m.spec.kind === 'exit'); }

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
      if (m.kind === 'belt') { if (m.fast === true) m.fast = true; else delete m.fast; }
    }
    else if (m.kind === 'station') {
      /* a status station is two tiles a side; the others are machines the page draws with places, a tray and a bay: 5 by 4 unless said otherwise */
      if (m.exec === 'native') { m.w = 2; m.h = 2; }
      else { m.w = Math.max(3, Math.min(8, Math.floor(m.w || 5))); m.h = Math.max(3, Math.min(6, Math.floor(m.h || 4))); }
      m.outcomes = Array.isArray(m.outcomes) && m.outcomes.length ? m.outcomes.map(String).filter(Boolean) : ['ok'];
      if (!m.outcomes.length) m.outcomes = ['ok'];
      m.cap = Math.max(1, Math.min(50, Math.floor(m.cap || 8)));
      if (!['agent', 'skill', 'panel', 'human_gate', 'native'].includes(m.exec)) throw new FactoryError(`unknown station executor "${String(m.exec)}"`);
      m.model = m.exec === 'agent' && typeof m.model === 'string' && m.model.trim() ? m.model.trim().slice(0, 120) : undefined;
      if (m.off === true && RUNS.includes(m.exec)) m.off = true; else delete m.off;
      if (typeof m.prompt === 'string' && m.prompt.length > 60_000) throw new FactoryError(`the instructions of ${m.name || 'a station'} are too long`);
    } else if (m.kind === 'zone') {
      m.w = Math.max(2, Math.min(30, Math.floor(m.w || 4))); m.h = Math.max(2, Math.min(30, Math.floor(m.h || 4)));
      m.release = m.release === 'auto' ? 'auto' : 'manual';
      m.inbound = m.inbound === true && !machines.some((o) => o.kind === 'zone' && o.inbound);
    } else if (m.kind === 'exit') { m.w = Math.max(1, Math.min(60, Math.floor(m.w || 3))); m.h = Math.max(1, Math.min(60, Math.floor(m.h || 3))); }
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
  /* the floor has no edge: `w` and `h` only record how far what is built extends */
  return { version: LAYOUT_VERSION, w: machines.length ? x1 - x0 : 0, h: machines.length ? y1 - y0 : 0, machines };
}

/**
 * The floor, as it runs. Nothing is routed in advance: a ticket reacts to what
 * it stands on. The engine owns the in-memory state, persists what changes, and
 * is the only writer of the three `factory_*` tables.
 */
export class FactoryEngine {
  private floor: FactoryFloorRow = { id: DEFAULT_FLOOR_ID, name: 'Factory', layout: { version: LAYOUT_VERSION, w: 48, h: 30, machines: [inboundZone(1, 1)] }, settings: { ...DEFAULT_SETTINGS }, createdAt: '', updatedAt: '' };
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
  /** Something the page should tell once: the floor was started over because its layout could not be carried to this version. */
  private notice: string | null = null;
  private readonly now: () => number;
  private readonly armSwing: number;
  private readonly restMs: number;

  constructor(private readonly deps: FactoryEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.armSwing = deps.timing?.armSwing ?? ARM_SWING;
    this.restMs = deps.timing?.stationRestMs ?? STATION_REST_MS;
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
        this.floor = { ...this.floor, layout: { version: LAYOUT_VERSION, w: 48, h: 30, machines: [inboundZone(1, 1)] }, updatedAt: nowIso };
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
      if (!this.ready || !enabled()) return;
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
    this.machines = layout.machines.map((spec) => ({ spec, takers: [], src: null, dst: null, item: null, item2: null, armState: 'rest' as const, armP: 0 }));
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
    if (m.spec.kind === 'belt') { if (m.item) { t.machineId = null; t.s.phase = 'loose'; this.dirty.add(t.ticketId); } else m.item = t; }
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
      if (m && (m.spec.kind === 'station' || m.spec.kind === 'zone')) { t.s.x = m.spec.x; t.s.y = m.spec.y; continue; }
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
    if (m && m.item === t) { m.item = null; if (m.spec.kind === 'arm') m.armState = 'back'; }
    if (m && m.item2 === t) m.item2 = null;
    t.machineId = null;
  }

  /** The only way a ticket changes place. */
  private accept(m: Machine, t: Ticket, fx?: number, fy?: number, p?: number): void {
    const spec = m.spec;
    t.machineId = spec.id; t.s.since = new Date(this.now()).toISOString(); t.s.released = false; t.s.runId = null; t.s.note = ''; t.s.x = spec.x; t.s.y = spec.y;
    this.dirty.add(t.ticketId);
    if (spec.kind === 'belt') { m.item = t; t.s.phase = 'belt'; t.s.p = p ?? 0.5; t.s.fx = fx ?? DX[spec.dir]; t.s.fy = fy ?? DY[spec.dir]; }
    else if (spec.kind === 'bridge') { t.s.phase = 'belt'; t.s.p = p ?? 0; t.s.fx = fx ?? 1; t.s.fy = fy ?? 0; if (t.s.fx !== 0) m.item = t; else m.item2 = t; }
    else if (spec.kind === 'station') {
      t.s.outcome = '';
      if (spec.exec === 'human_gate') { t.s.phase = 'review'; this.openRun(spec, t, 'needs_review'); }
      else if (spec.exec === 'native') {
        t.s.phase = 'out'; t.s.outcome = spec.outcomes[0] ?? 'ok';
        if (spec.sets) this.applyStatus(t, spec.sets);
      } else t.s.phase = 'wait';
    } else if (spec.kind === 'zone') { t.s.phase = 'zone'; if (spec.status) this.applyStatus(t, spec.status); }
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
    if (s.spec.kind === 'zone') return this.inside(s).find((t) => t.s.released && this.wants(arm, t)) ?? null;
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
    if (!t) return;
    /* an arm that wants this ticket gets it: the belt holds it in the middle of the tile */
    const held = b.takers.some((a) => this.wants(a, t));
    t.s.p = Math.min(t.s.p + BELT_SPEED * (spec.fast ? FAST_BELT : 1) * dt, held && t.s.p <= 0.5 ? 0.5 : 1);
    if (t.s.p < 1) return;
    const n = this.at(spec.x + DX[spec.dir], spec.y + DY[spec.dir]);
    if (this.hand(n, t, DX[spec.dir], DY[spec.dir])) b.item = null;
  }

  /** Pass a ticket travelling in a direction to the next tile, if that tile can take it now. */
  private hand(n: Machine | null, t: Ticket, fx: number, fy: number): boolean {
    if (!n) return false;
    if (n.spec.kind === 'belt') { if (n.item) return false; this.accept(n, t, fx, fy, 0); return true; }
    if (n.spec.kind === 'bridge') { if (fx !== 0 ? n.item : n.item2) return false; this.accept(n, t, fx, fy, 0); return true; }
    if (isBox(n) && this.canTake(n)) { this.accept(n, t); return true; }
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

  // ---------- the tick ----------

  tick(dt: number): void {
    for (const m of this.machines) {
      const k = m.spec.kind;
      if (k === 'belt') this.updateBelt(m, dt);
      else if (k === 'bridge') this.updateBridge(m, dt);
      else if (k === 'arm') this.updateArm(m, dt);
      else if (k === 'station') this.updateStation(m);
      else if (k === 'zone') this.updateZone(m);
    }
  }

  async flush(): Promise<void> {
    const ids = [...this.dirty]; this.dirty.clear();
    const nowIso = new Date(this.now()).toISOString();
    for (const id of ids) {
      const t = this.tickets.get(id);
      if (!t) continue;
      try { await this.deps.store.saveTicket({ ticketId: t.ticketId, floorId: this.floor.id, machineId: t.machineId, state: t.s, createdAt: t.createdAt, updatedAt: nowIso }); }
      catch (err) { this.dirty.add(id); this.deps.logger.warn('Factory: could not save a ticket position', { ticketId: id, error: String(err) }); }
    }
  }

  /** Re-read type, priority, status and tags; a ticket that was deleted or archived leaves the floor. */
  async refreshInfos(): Promise<void> {
    for (const t of [...this.tickets.values()]) {
      try {
        const info = await this.deps.loadTicket(t.ticketId);
        if (info) t.info = info;
        else if (this.tickets.get(t.ticketId) === t) { this.detach(t); this.tickets.delete(t.ticketId); this.dirty.delete(t.ticketId); await this.deps.store.removeTicket(t.ticketId); }
      } catch (err) { this.deps.logger.warn('Factory: could not refresh a ticket', { ticketId: t.ticketId, error: String(err) }); }
    }
  }

  /** Re-read one ticket now, after it was changed from the Factory page (a favourite toggled), without waiting for the next sweep. */
  async refreshInfo(ticketId: string): Promise<void> {
    const t = this.get(ticketId), info = await this.deps.loadTicket(ticketId);
    if (info) t.info = info;
  }

  // ---------- what a human does ----------

  private get(ticketId: string): Ticket {
    const t = this.tickets.get(ticketId);
    if (!t) throw new FactoryError('This ticket is not on the factory floor');
    return t;
  }

  managedIds(): Set<string> { return new Set(this.tickets.keys()); }
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
   * to be dragged onto the floor; otherwise on the machine or the tile that was asked for.
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
    this.tickets.set(ticketId, t);
    this.place(t, target);
    await this.flush();
  }

  private place(t: Ticket, target: { machineId?: string; x?: number; y?: number }): void {
    const m = target.machineId ? this.byId.get(target.machineId) ?? null : target.x != null && target.y != null ? this.at(Math.floor(target.x), Math.floor(target.y)) : null;
    if (target.machineId && !m) throw new FactoryError('Unknown machine');
    if (m && !this.canTake(m)) throw new FactoryError(m.spec.kind === 'belt' ? 'This belt tile is taken' : m.spec.kind === 'station' ? `${m.spec.name || 'This station'} is full` : m.spec.kind === 'bridge' ? 'A ticket cannot be dropped on a bridge: put it on the belt before it' : 'A ticket cannot be dropped on this machine');
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
    this.detach(t); this.tickets.delete(ticketId); this.dirty.delete(ticketId);
    await this.deps.store.removeTicket(ticketId);
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
    if (this.deps.recordDecision) void this.deps.recordDecision(ticketId, m.spec.name || 'Gate', outcome, reason.trim().slice(0, 4000))
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

  /** The page has shown the notice. */
  ackNotice(): void { this.notice = null; }

  snapshot(): FactorySnapshot {
    return {
      notice: this.notice,
      floor: { id: this.floor.id, name: this.floor.name, layout: this.floor.layout, settings: this.floor.settings },
      tickets: [...this.tickets.values()].map((t) => ({ ticketId: t.ticketId, machineId: t.machineId, info: t.info, handedAt: t.createdAt, ...t.s })),
      arms: this.machines.filter((m) => m.spec.kind === 'arm').map((m) => ({ id: m.spec.id, p: m.armP, state: m.armState, carrying: m.item ? m.item.ticketId : null })),
      armSwing: this.armSwing, beltSpeed: BELT_SPEED, fastBelt: FAST_BELT,
      runsLastHour: this.runsLastHour(), running: this.runningCount(), serverTime: new Date(this.now()).toISOString(),
    };
  }
}
