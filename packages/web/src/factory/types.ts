/**
 * The Factory's wire types. They mirror `packages/server/src/factory/types.ts`
 * and stay here, not in `@fleex/shared`, so the experiment can be removed by
 * deleting two folders.
 */
import type { SetOp } from './setOps';
import type { ScriptSpec } from './script';
export type { SetOp } from './setOps';
import type { TicketStatus } from '@fleex/shared';

export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export type StationExec = 'agent' | 'skill' | 'panel' | 'script' | 'human_gate' | 'native';
/** What an arm can look at on a ticket, and how it compares it. Mirrors the server's `types.ts`. */
export type ArmField = 'type' | 'priority' | 'complexity' | 'board' | 'favorite' | 'tag' | 'tagkey' | 'outcome';
export type ArmOp = 'is' | 'is_not' | 'gte' | 'lte' | 'gt' | 'lt' | 'between';
export interface ArmCondition { field: ArmField; op: ArmOp; values: string[] }

interface MachineBase { id: string; x: number; y: number; w: number; h: number; name?: string }
export interface BeltSpec extends MachineBase {
  kind: 'belt'; dir: Dir;
  /** A fast belt: it carries a ticket across its tile in half the time. */
  fast?: boolean;
  /** A Set gantry over the tile: what it does to every ticket that goes under it (see `setOps.ts`). Present, even empty, the belt carries a gantry. */ set?: SetOp[];
  /** A toll: once the gantry has done its work, a ticket any of these conditions holds for is taken off the belt by the toll's own arm, to the tile on the side `out`. */
  toll?: { when: ArmCondition[]; out: Dir };
}
export interface ArmSpec extends MachineBase {
  kind: 'arm'; dir: Dir;
  /** Takes a ticket when all of these hold; with none, what its neighbours' conditions leave. */
  when?: ArmCondition[];
  /** The colour it was given by hand (one of `PALETTE`). Without one it has its own: grey, or amber when it has conditions. */
  color?: string;
  /** The single condition of floors saved before `when`: still read, rewritten at the next save. */
  filter?: { field: string; values: string[] } | null;
}
export interface StationSpec extends MachineBase {
  kind: 'station'; exec: StationExec; ref?: string; mode?: 'talk' | 'plan' | 'edit'; prompt?: string;
  /** Agent and skill stations: the model to run on instead of the persona's own (a skill's persona). */
  model?: string;
  outcomes: string[]; cap: number; sets?: TicketStatus;
  /** Agent, skill and panel stations: switched off, it takes tickets in but starts nothing on them. */
  off?: boolean;
  /** A script station: the shell commands it runs for a ticket (see `script.ts`). */
  script?: ScriptSpec;
}
export interface ZoneSpec extends MachineBase { kind: 'zone'; status?: TicketStatus | ''; release: 'manual' | 'auto'; limit?: number; inbound?: boolean }
export interface ExitSpec extends MachineBase { kind: 'exit' }
export interface LabelSpec extends MachineBase { kind: 'label'; text: string; color?: string }
/** Where two belts cross: a ticket that enters keeps going straight. */
export interface BridgeSpec extends MachineBase { kind: 'bridge' }
/**
 * A jump across the floor, on one tile. A departure takes one ticket and sends it to the arrival it is set to (`to`,
 * that arrival's id); an arrival holds one ticket, takes nothing from the floor, and an arm takes the ticket out.
 */
export interface TeleporterSpec extends MachineBase { kind: 'teleporter'; role: 'departure' | 'arrival'; to?: string; /** One of `PALETTE`; without one, see `portColor`. */ color?: string }
/** Where an Area's name is written: in one of its corners, or over or under it. */
export type AreaLabel = 'tl' | 'tr' | 'bl' | 'br' | 'above' | 'below';
/**
 * A part of the floor named as a place ("Build line"): a rectangle of tiles, a name, a colour. Decor: the engine
 * ignores it, it takes no tile (machines stand on it), nothing links it to them, and out of build mode it answers no
 * click. Seen from three quarters it is a platform that raises what stands wholly on it.
 */
export interface AreaSpec extends MachineBase { kind: 'area'; name: string; color: string; label?: AreaLabel }
export type MachineSpec = BeltSpec | ArmSpec | StationSpec | ZoneSpec | ExitSpec | LabelSpec | BridgeSpec | TeleporterSpec | AreaSpec;
export type MachineKind = MachineSpec['kind'];

/** `version` says what the document means; the engine sets it, and starts a floor over when it cannot carry an older one across. */
export interface FactoryLayout { version?: number; w: number; h: number; machines: MachineSpec[] }
export interface FactorySettings {
  maxRunsPerHour: number; maxConcurrentRuns: number; /** The emergency stop is on: nothing moves, nothing runs. */ halted?: boolean;
  /** The saved selections (Shift+1…9, Shift+0), slot by slot: kept with the floor so a reload does not lose them. */
  groups?: Selection[];
}

export type TicketPhase = 'loose' | 'belt' | 'arm' | 'wait' | 'running' | 'review' | 'question' | 'failed' | 'aside' | 'out' | 'zone' | 'port';
/** The three ways a ticket is set aside in its station: the agent asked, the run failed, or a human took it. It waits there to be put back. */
export const SET_ASIDE: readonly TicketPhase[] = ['question', 'failed', 'aside'];
/** The stations that run something: they have a switch, and tickets can be set aside in them. */
export const RUNS: readonly StationExec[] = ['agent', 'skill', 'panel', 'script'];
export interface FactoryTicketInfo {
  id: string; displayId: number; title: string; type: string; priority: string; status: TicketStatus; tags: string[];
  boardId: string; complexity: string | null; favorite: boolean;
  /** Absent on a snapshot from a server older than this field. */
  blocked?: boolean;
}
export interface FactoryTicket {
  ticketId: string; machineId: string | null; info: FactoryTicketInfo | null;
  x: number; y: number; phase: TicketPhase; p: number; fx: number; fy: number;
  outcome: string; released: boolean; since: string; runId: string | null; note: string;
  /** When it was handed over to the Factory (ISO). */
  handedAt: string;
}
export interface FactorySnapshot {
  floor: { id: string; name: string; layout: FactoryLayout; settings: FactorySettings };
  tickets: FactoryTicket[];
  arms: { id: string; p: number; state?: 'rest' | 'carry' | 'back'; carrying: string | null }[];
  /** Seconds an arm takes to swing one way. */
  armSwing?: number;
  /** Tiles a belt carries a ticket per second, and how many times faster a fast belt does. */
  beltSpeed?: number;
  fastBelt?: number;
  runsLastHour: number;
  running: number;
  serverTime: string;
  /** Something to tell once (the floor was started over for a new layout version). */
  notice?: string | null;
}
/** A station visit, or a ticket reaching an exit (`startedAt` is then when it was handed over). */
export type RunExecutor = StationExec | 'exit';
export interface FactoryRun {
  id: string; ticketId: string; machineId: string; machineName: string; executor: RunExecutor;
  status: 'running' | 'completed' | 'failed' | 'needs_review' | 'question' | 'interrupted';
  outcome: string | null; executionId: string | null; error: string | null; startedAt: string; finishedAt: string | null;
}
/** What one machine did over the period. Mirrors `MachineStats` in the server's `factory/stats.ts`. */
export interface MachineStats {
  machineId: string; name: string; executor: RunExecutor; onFloor: boolean;
  runs: number; completed: number; failed: number; questions: number;
  avgRunMs: number | null; avgHumanMs: number | null; humanWaits: number; humanMs: number;
  costUsd: number; outcomes: Record<string, number>;
}
export interface FactoryStats {
  since: string; until: string; days: number; machines: MachineStats[];
  totals: { runs: number; failed: number; questions: number; costUsd: number; shipped: number; avgLeadMs: number | null; humanMs: number };
  /** How many tickets left by each exit, by machine id. */
  exits?: Record<string, number>;
}
/** What the floor is tinted by: nothing, money spent, run time, time waiting for a human, or what stands there now. */
export type Lens = 'none' | 'cost' | 'time' | 'human' | 'load';
/** When a run row belongs on a ticket's timeline: a shipment is dated by its arrival at the exit, not by the hand-over it starts from. */
export const runAt = (r: FactoryRun): string => (r.executor === 'exit' ? r.finishedAt ?? r.startedAt : r.startedAt);
export const byRunAt = (a: FactoryRun, b: FactoryRun): number => runAt(a).localeCompare(runAt(b));
export type Target = { machineId?: string; x?: number; y?: number };

/** Mirrors `QUESTION_OUTCOME` in the engine: the outcome of a run where the agent asked instead of answering. */
export const QUESTION_OUTCOME = 'question';

/** What a human is expected to do on a ticket: answer, decide, or look at a failure. Drives the "?" on the floor. */
export type HumanCall = 'question' | 'decision' | 'failed';
export function humanCall(t: FactoryTicket): HumanCall | null {
  if (t.phase === 'review') return 'decision';
  if (t.phase === 'failed') return 'failed';
  /* a question stays unanswered while the ticket travels (an arm filtered on "question"), until a station takes it again */
  if (t.phase === 'question' || t.outcome === QUESTION_OUTCOME) return 'question';
  return null;
}

/** A ticket that waits for a human, and why. */
export function needsHuman(t: FactoryTicket): string | null {
  const call = humanCall(t);
  if (call === 'decision') return 'Waiting for your decision';
  if (call === 'question') return 'The agent asked a question';
  if (call === 'failed') return 'The run failed';
  if (t.phase === 'aside') return 'Set aside: waiting to be put back';
  if (t.phase === 'loose') return 'Lying on the floor';
  return null;
}

/** A ticket a station is working on (held, running, or done and not yet taken) can be set aside in it; nothing else can. */
export function canSetAside(t: { phase: TicketPhase }, machine: MachineSpec | null | undefined): boolean {
  return !!machine && machine.kind === 'station' && RUNS.includes(machine.exec) && (t.phase === 'wait' || t.phase === 'running' || t.phase === 'out');
}

/** What is selected on the floor: one machine, several (build mode), a ticket, or several tickets (a frame dragged out of build mode). */
export type Selection = { machine: string } | { machines: string[] } | { ticket: string } | { tickets: string[] } | null;

/** Colours a label can take on the floor. */
/** The colours a machine can be given by hand: sixteen, each bright enough to read on the floor of a dark or a light theme. */
export const PALETTE: readonly { name: string; hex: string }[] = [
  { name: 'Grey', hex: '#a1a1aa' }, { name: 'White', hex: '#f4f4f5' }, { name: 'Red', hex: '#ef4444' }, { name: 'Rose', hex: '#fb7185' },
  { name: 'Orange', hex: '#fb923c' }, { name: 'Amber', hex: '#f59e0b' }, { name: 'Yellow', hex: '#facc15' }, { name: 'Lime', hex: '#a3e635' },
  { name: 'Green', hex: '#22c55e' }, { name: 'Teal', hex: '#2dd4bf' }, { name: 'Cyan', hex: '#22d3ee' }, { name: 'Sky', hex: '#38bdf8' },
  { name: 'Blue', hex: '#60a5fa' }, { name: 'Indigo', hex: '#818cf8' }, { name: 'Purple', hex: '#c084fc' }, { name: 'Pink', hex: '#f472b6' },
];
export const LABEL_COLORS = ['#a1a1aa', '#c084fc', '#60a5fa', '#2dd4bf', '#4ade80', '#facc15', '#fb923c', '#f87171'];

/** A machine that has something to set up or to show in its own popup: everything but what only carries tickets. */
export const hasPopup = (m: { kind: MachineSpec['kind']; set?: unknown }): boolean => (m.kind !== 'belt' || m.set !== undefined) && m.kind !== 'bridge';
/** A belt that carries a Set gantry. */
/** A belt that carries a toll: a gantry with something to reject, and an arm for it. */
export const isToll = (m: MachineSpec | null | undefined): m is BeltSpec & { set: SetOp[]; toll: { when: ArmCondition[]; out: Dir } } => !!m && m.kind === 'belt' && !!m.toll;
export const isGantry = (m: MachineSpec | null | undefined): m is BeltSpec & { set: SetOp[] } => !!m && m.kind === 'belt' && m.set !== undefined;
