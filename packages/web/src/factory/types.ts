/**
 * The Factory's wire types. They mirror `packages/server/src/factory/types.ts`
 * and stay here, not in `@fleex/shared`, so the experiment can be removed by
 * deleting two folders.
 */
import type { TicketStatus } from '@fleex/shared';

export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export type StationExec = 'agent' | 'skill' | 'panel' | 'human_gate' | 'native';
/** What an arm can look at on a ticket, and how it compares it. Mirrors the server's `types.ts`. */
export type ArmField = 'type' | 'priority' | 'complexity' | 'board' | 'favorite' | 'tag' | 'outcome';
export type ArmOp = 'is' | 'is_not' | 'gte' | 'lte' | 'gt' | 'lt' | 'between';
export interface ArmCondition { field: ArmField; op: ArmOp; values: string[] }

interface MachineBase { id: string; x: number; y: number; w: number; h: number; name?: string }
export interface BeltSpec extends MachineBase { kind: 'belt'; dir: Dir }
export interface ArmSpec extends MachineBase {
  kind: 'arm'; dir: Dir;
  /** Takes a ticket when all of these hold; with none, what its neighbours' conditions leave. */
  when?: ArmCondition[];
  /** The single condition of floors saved before `when`: still read, rewritten at the next save. */
  filter?: { field: string; values: string[] } | null;
}
export interface StationSpec extends MachineBase {
  kind: 'station'; exec: StationExec; ref?: string; mode?: 'talk' | 'plan' | 'edit'; prompt?: string;
  /** Agent stations: the model to run on instead of the persona's own. */
  model?: string;
  outcomes: string[]; cap: number; sets?: TicketStatus;
}
export interface ZoneSpec extends MachineBase { kind: 'zone'; status?: TicketStatus | ''; release: 'manual' | 'auto'; limit?: number; inbound?: boolean }
export interface ExitSpec extends MachineBase { kind: 'exit' }
export interface LabelSpec extends MachineBase { kind: 'label'; text: string; color?: string }
/** Where two belts cross: a ticket that enters keeps going straight. */
export interface BridgeSpec extends MachineBase { kind: 'bridge' }
export type MachineSpec = BeltSpec | ArmSpec | StationSpec | ZoneSpec | ExitSpec | LabelSpec | BridgeSpec;
export type MachineKind = MachineSpec['kind'];

export interface FactoryLayout { w: number; h: number; machines: MachineSpec[] }
export interface FactorySettings { maxRunsPerHour: number; maxConcurrentRuns: number }

export type TicketPhase = 'loose' | 'belt' | 'arm' | 'wait' | 'running' | 'review' | 'question' | 'failed' | 'out' | 'zone';
export interface FactoryTicketInfo {
  id: string; displayId: number; title: string; type: string; priority: string; status: TicketStatus; tags: string[];
  boardId: string; complexity: string | null; favorite: boolean;
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
  runsLastHour: number;
  running: number;
  serverTime: string;
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
}
/** What the floor is tinted by: nothing, money spent, run time, time waiting for a human, or what stands there now. */
export type Lens = 'none' | 'cost' | 'time' | 'human' | 'load';
/** When a run row belongs on a ticket's timeline: a shipment is dated by its arrival at the exit, not by the hand-over it starts from. */
export const runAt = (r: FactoryRun): string => (r.executor === 'exit' ? r.finishedAt ?? r.startedAt : r.startedAt);
export const byRunAt = (a: FactoryRun, b: FactoryRun): number => runAt(a).localeCompare(runAt(b));
export type Target = { machineId?: string; x?: number; y?: number };

/** Mirrors `QUESTION_OUTCOME` in the engine: the outcome of a run where the agent asked instead of answering. */
export const QUESTION_OUTCOME = 'question';

/** What a human is expected to do on a ticket: answer, decide, or look at a failure. Drives the "?" on the floor and the ticket banner. */
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
  if (t.phase === 'loose') return 'Lying on the floor';
  return null;
}
