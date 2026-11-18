import type { TicketStatus } from '@fleex/shared';

/** 0 east, 1 south, 2 west, 3 north. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export type StationExec = 'agent' | 'skill' | 'panel' | 'human_gate' | 'native';
/** What an arm can look at on a ticket, and how it compares it. */
export type ArmField = 'type' | 'priority' | 'complexity' | 'board' | 'favorite' | 'tag' | 'outcome';
export type ArmOp = 'is' | 'is_not' | 'gte' | 'lte' | 'gt' | 'lt' | 'between';
/**
 * One thing an arm asks of a ticket. `values` are type names, priorities, complexity points, board ids, tags or
 * station outcomes; `none` stands for no type, no priority or not estimated. `between` takes two, the ordered
 * operators one, `is` and `is_not` any number (any of them). A favourite condition carries no value that matters.
 */
export interface ArmCondition { field: ArmField; op: ArmOp; values: string[] }

interface MachineBase { id: string; x: number; y: number; w: number; h: number; name?: string }
/** One tile, one ticket: pushes it to the tile it points at when that tile can take it. */
export interface BeltSpec extends MachineBase {
  kind: 'belt'; dir: Dir;
  /** A fast belt: it carries a ticket across its tile in half the time. */
  fast?: boolean;
}
/** Takes from the tile behind it, drops on the tile in front; with conditions, only a ticket that meets them all. */
export interface ArmSpec extends MachineBase {
  kind: 'arm'; dir: Dir;
  when?: ArmCondition[];
  /** The colour it was given by hand, as `#rrggbb`. Without one the page gives it its own: grey, or amber when it has conditions. */
  color?: string;
  /** How floors saved before `when` wrote a single condition. Still read; rewritten as `when` at the next save. */
  filter?: { field: string; values: string[] } | null;
}
export interface StationSpec extends MachineBase {
  kind: 'station';
  exec: StationExec;
  /** Persona name, skill command name or panel name. Unused by gates and native stations. */
  ref?: string;
  mode?: 'talk' | 'plan' | 'edit';
  /** Agent stations: the model to run on instead of the persona's own. Empty: the persona's. */
  model?: string;
  prompt?: string;
  /** The first one is the way forward. Each one leaves through the arm whose `outcome` filter holds it. */
  outcomes: string[];
  /**
   * How many tickets it works on at once: full, it takes nothing more and whatever feeds it backs up on the belts.
   * A ticket set aside in it (a question, a failed run, one a human stopped) no longer takes one of these places.
   */
  cap: number;
  /** Agent, skill and panel stations: switched off, it still takes tickets in but starts nothing on them. */
  off?: boolean;
  /** Native stations: the status to set. */
  sets?: TicketStatus;
}
/** Where tickets wait. Sets a status on entry; an arm only takes what has been released. */
export interface ZoneSpec extends MachineBase {
  kind: 'zone'; status?: TicketStatus | ''; release: 'manual' | 'auto'; limit?: number;
  /** Where a ticket lands when it is handed over without saying where. One per floor. */
  inbound?: boolean;
}
/** Sets the ticket to `done` and hands it back to plain Fleex. */
export interface ExitSpec extends MachineBase { kind: 'exit' }
export interface LabelSpec extends MachineBase { kind: 'label'; text: string; color?: string }
/**
 * Where two belts cross: one tile, two lanes. A ticket that enters keeps going straight, so a line
 * running east-west and a line running north-south pass over each other without mixing.
 */
export interface BridgeSpec extends MachineBase { kind: 'bridge' }
/**
 * A jump across the floor, on one tile. A departure takes one ticket (from an arm, a belt or a hand) and sends it to
 * the arrival it is set to (`to`, that arrival's id) as soon as that arrival is free. An arrival holds one ticket:
 * nothing on the floor can put one in it, it only receives from its departures, and an arm takes the ticket out.
 * Several departures can lead to one arrival: their tickets wait where they are, the one that came first goes first.
 */
export interface TeleporterSpec extends MachineBase {
  kind: 'teleporter'; role: 'departure' | 'arrival';
  to?: string;
  /** The colour it was given by hand, as `#rrggbb`: paint, nothing more. */
  color?: string;
}
export type MachineSpec = BeltSpec | ArmSpec | StationSpec | ZoneSpec | ExitSpec | LabelSpec | BridgeSpec | TeleporterSpec;

/**
 * `w` and `h` are the extent of what is built, kept for reference: the floor itself has no edge. `version` says what
 * the document means (see `layout-versions.ts`); a layout without one predates versions.
 */
export interface FactoryLayout { version?: number; w: number; h: number; machines: MachineSpec[] }
export interface FactorySettings {
  /** Station runs the Factory may start per rolling hour. A runaway floor stops here. */
  maxRunsPerHour: number;
  /** Station runs the Factory may have in flight at once (on top of the global agent limit). */
  maxConcurrentRuns: number;
}
export const DEFAULT_SETTINGS: FactorySettings = { maxRunsPerHour: 20, maxConcurrentRuns: 3 };
export const DEFAULT_FLOOR_ID = 'default';

/**
 * Where a ticket stands:
 * loose (on the floor) · belt · arm · wait (in a station, run not started) · running ·
 * review (a gate waits for a human) · question (the agent asked something) ·
 * failed · aside (a human took it off the station's hands) · out (done, waits for an arm) · zone ·
 * port (in a teleporter: about to be sent, or waiting to be taken out)
 *
 * `question`, `failed` and `aside` are the three ways a ticket is set aside in its station: it stays there, takes
 * none of the station's places, and waits for a human to put it back.
 */
export type TicketPhase = 'loose' | 'belt' | 'arm' | 'wait' | 'running' | 'review' | 'question' | 'failed' | 'aside' | 'out' | 'zone' | 'port';
export const SET_ASIDE: readonly TicketPhase[] = ['question', 'failed', 'aside'];
/** The stations that run something, and so can be switched off and have tickets set aside in them. */
export const RUNS: readonly StationExec[] = ['agent', 'skill', 'panel'];
export interface FactoryTicketState {
  x: number; y: number;
  phase: TicketPhase;
  /** Progress on a belt tile or in an arm, 0..1. */
  p: number;
  /** Direction of travel when it entered its belt tile. */
  fx: number; fy: number;
  /** What the last station concluded; arms filter on it. */
  outcome: string;
  /** Zones: allowed to leave. */
  released: boolean;
  /** When it entered its current machine (ISO). */
  since: string;
  runId: string | null;
  /** Why it is stuck, in plain words (failed run, limit reached). */
  note: string;
}

export interface FactoryFloorRow { id: string; name: string; layout: FactoryLayout; settings: FactorySettings; createdAt: string; updatedAt: string }
export interface FactoryTicketRow { ticketId: string; floorId: string; machineId: string | null; state: FactoryTicketState; createdAt: string; updatedAt: string }
/** What a run row records: a station visit, or a ticket reaching an exit (`startedAt` is then when it was handed over). */
export type RunExecutor = StationExec | 'exit';
export type FactoryRunStatus = 'running' | 'completed' | 'failed' | 'needs_review' | 'question' | 'interrupted';
export interface FactoryRunRow {
  id: string; ticketId: string; floorId: string; machineId: string; machineName: string; executor: RunExecutor;
  status: FactoryRunStatus; outcome: string | null; executionId: string | null; error: string | null;
  startedAt: string; finishedAt: string | null;
}

/** What the engine needs to know about a ticket to route it and to show it. */
export interface FactoryTicketInfo {
  id: string; displayId: number; title: string; type: string; priority: string; status: TicketStatus; tags: string[];
  /** What the page needs to tell tickets apart and to filter them; the engine routes on none of it. */
  boardId: string; complexity: string | null; favorite: boolean; blocked: boolean;
}
