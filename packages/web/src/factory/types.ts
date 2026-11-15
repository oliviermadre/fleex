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
export type ArmFilterField = 'type' | 'priority' | 'outcome' | 'tag';

interface MachineBase { id: string; x: number; y: number; w: number; h: number; name?: string }
export interface BeltSpec extends MachineBase { kind: 'belt'; dir: Dir }
export interface ArmSpec extends MachineBase { kind: 'arm'; dir: Dir; filter?: { field: ArmFilterField; values: string[] } | null }
export interface StationSpec extends MachineBase {
  kind: 'station'; exec: StationExec; ref?: string; mode?: 'talk' | 'plan' | 'edit'; prompt?: string;
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
export interface FactoryTicketInfo { id: string; displayId: number; title: string; type: string; priority: string; status: TicketStatus; tags: string[] }
export interface FactoryTicket {
  ticketId: string; machineId: string | null; info: FactoryTicketInfo | null;
  x: number; y: number; phase: TicketPhase; p: number; fx: number; fy: number;
  outcome: string; released: boolean; since: string; runId: string | null; note: string;
}
export interface FactorySnapshot {
  floor: { id: string; name: string; layout: FactoryLayout; settings: FactorySettings };
  tickets: FactoryTicket[];
  arms: { id: string; p: number; carrying: string | null }[];
  runsLastHour: number;
  running: number;
  serverTime: string;
}
export interface FactoryRun {
  id: string; ticketId: string; machineId: string; machineName: string; executor: StationExec;
  status: 'running' | 'completed' | 'failed' | 'needs_review' | 'question' | 'interrupted';
  outcome: string | null; executionId: string | null; error: string | null; startedAt: string; finishedAt: string | null;
}
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
