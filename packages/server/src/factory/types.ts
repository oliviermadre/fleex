import type { TicketStatus } from '@fleex/shared';
import type { SetOp } from './set-ops.js';
import type { ScriptSpec } from './script-runner.js';
export type { ScriptSpec, ScriptLine } from './script-runner.js';
export type { SetOp } from './set-ops.js';

/** 0 east, 1 south, 2 west, 3 north. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export type StationExec = 'agent' | 'skill' | 'panel' | 'script' | 'human_gate' | 'native';
/** What an arm can look at on a ticket, and how it compares it. */
export type ArmField = 'type' | 'priority' | 'complexity' | 'board' | 'favorite' | 'tag' | 'tagkey' | 'outcome';
export type ArmOp = 'is' | 'is_not' | 'gte' | 'lte' | 'gt' | 'lt' | 'between';
/**
 * One thing an arm asks of a ticket. `values` are type names, priorities, complexity points, board ids, tags or
 * station outcomes; `none` stands for no type, no priority or not estimated. `between` takes two, the ordered
 * operators one, `is` and `is_not` any number (any of them). A favourite condition carries no value that matters.
 * `tagkey` compares the value of a `key:value` tag: its values are the key, then what to compare to (see `tags.ts`).
 */
export interface ArmCondition { field: ArmField; op: ArmOp; values: string[] }

interface MachineBase { id: string; x: number; y: number; w: number; h: number; name?: string }
/** One tile, one ticket: pushes it to the tile it points at when that tile can take it. */
export interface BeltSpec extends MachineBase {
  kind: 'belt'; dir: Dir;
  /** A fast belt: it carries a ticket across its tile in half the time. */
  fast?: boolean;
  /**
   * A Set gantry over the tile: what it does to every ticket that goes under it (see `set-ops.ts`). The ticket stops
   * in the middle of the tile until what was changed is written on it, then goes on. Present, even empty, the belt
   * carries a gantry.
   */
  set?: SetOp[];
  /**
   * A toll: the gantry with something to reject. Once the gantry has done its work on a ticket, the ticket is tested
   * against these conditions; if any of them holds, the toll's own arm takes it off the belt and puts it on the tile
   * next to it, on the side `out` (across the belt). Otherwise it goes on. So "add 1 to passes, reject when passes
   * is above 3" lets a ticket round a loop three times.
   */
  toll?: { when: ArmCondition[]; out: Dir };
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
  /** Agent and skill stations: the model to run on instead of the persona's own (a skill's persona). Empty: the persona's. */
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
  /** A script station: the shell commands it runs for a ticket (see `script-runner.ts`). */
  script?: ScriptSpec;
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
/**
 * Where a ticket is born on the floor: the ticket creation form opens on it, and the ticket it creates is handed over
 * to the Factory right there. Nothing on the floor can put a ticket into a desk; an arm takes what it holds out, at
 * once. `defaults` prefill the form (board, type, priority): a "Bug desk" wired to a line of fixes routes by being used.
 */
export interface DeskSpec extends MachineBase {
  kind: 'desk';
  defaults?: { boardId?: string; type?: string; priority?: string };
}
/** Where items come from. `manual` is an item made by hand (a test, or a source not connected yet). */
export type ItemSource = 'slack' | 'gmail' | 'github' | 'manual';
export const ITEM_SOURCES: readonly ItemSource[] = ['slack', 'gmail', 'github', 'manual'];
/** A rule of an intake: an item whose field contains this text (any case) is dropped, and never reaches the floor. */
export interface DropRule { field: 'author' | 'title' | 'text'; contains: string }
/**
 * Where items of one source come in (picked on `docs/factory/intake.html`, I1): a dock of 3 by 2. An item waits in it
 * while its conversation moves, and is let out once it has been quiet for `quietSec`; an arm then takes it. What the
 * rules recognise (a newsletter, a bot) is dropped there, counted, and never reaches the floor. Nothing on the floor
 * can put anything into it.
 */
export interface IntakeSpec extends MachineBase {
  kind: 'intake'; source: ItemSource;
  /** Seconds a conversation must have been quiet before its item leaves. 0: at once. */
  quietSec?: number;
  drop?: DropRule[];
}
/** Where an Area's name is written: in one of its corners, or over or under it. */
export type AreaLabel = 'tl' | 'tr' | 'bl' | 'br' | 'above' | 'below';
export const AREA_LABELS: readonly AreaLabel[] = ['tl', 'tr', 'bl', 'br', 'above', 'below'];
/**
 * A part of the floor named as a place ("Build line"): a rectangle of tiles, a name, a colour. Decor: the engine
 * ignores it, it takes no tile (machines stand on it), and nothing links it to them. Two areas never cross: one lies
 * wholly inside the other, or they do not meet.
 */
export interface AreaSpec extends MachineBase { kind: 'area'; name: string; color: string; label?: AreaLabel }
export type MachineSpec = BeltSpec | ArmSpec | StationSpec | ZoneSpec | ExitSpec | LabelSpec | BridgeSpec | TeleporterSpec | AreaSpec | DeskSpec | IntakeSpec;

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
  /** The emergency stop is on: nothing moves and nothing runs until it is lifted. Kept across restarts. */
  halted?: boolean;
  /**
   * The saved selections of the floor (Shift+1…9, Shift+0), slot by slot: kept with the floor so that a reload or a
   * restart does not lose them. Ids of machines or tickets that have since gone are left in, and ignored on use.
   */
  groups?: FactoryGroup[];
}
/** A saved selection: one or several machines, or one or several tickets; null for an empty slot. */
export type FactoryGroup = { machine: string } | { machines: string[] } | { ticket: string } | { tickets: string[] } | null;
/** How many saved selections a floor has: one per digit key. */
export const GROUP_SLOTS = 10;
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
export const RUNS: readonly StationExec[] = ['agent', 'skill', 'panel', 'script'];
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
  /**
   * A visit to an item (then `ticketId` is the item's id, and the row goes to `factory_item_runs`): what the station
   * answered, since an item has no thread, and the deliverable it produced.
   */
  reply?: string | null; deliverableId?: string | null;
}

/**
 * An item: a conversation that came in from a source, and is not a ticket. It travels the floor as a ticket does, with
 * its own row (`factory_items`): `machineId` and `state` are where it stands, as `factory_tickets` has it for a ticket.
 */
export interface FactoryItemRow {
  id: string; floorId: string; source: ItemSource;
  /** Its key in its source: workspace + channel + thread, a mail thread id, repository + pull request number. */
  sourceKey: string;
  title: string; author: string; excerpt: string; url: string | null; tags: string[];
  /** How many messages the conversation has had, and when the last one came. */
  messages: number; lastActivityAt: string;
  /** The intake it came in by. */
  intakeId: string | null;
  machineId: string | null; state: FactoryTicketState | null;
  archivedAt: string | null; archivedReason: 'junk' | 'exit' | 'dropped' | null;
  createdAt: string; updatedAt: string;
}
/** What the page is told of an item, beside the ticket-like fields every token has. */
export interface FactoryItemInfo { source: ItemSource; author: string; excerpt: string; url: string | null; messages: number; lastActivityAt: string }
/** What a source says about a conversation that moved: a new one, or a new message on one already known. */
export interface ItemInput {
  source: ItemSource; key: string; title: string;
  author?: string; excerpt?: string; url?: string | null; tags?: string[];
  /** How many messages it has now; without it, one more than known. */
  messages?: number;
}

/** What the engine needs to know about a ticket to route it and to show it. */
export interface FactoryTicketInfo {
  id: string; displayId: number; title: string; type: string; priority: string; status: TicketStatus; tags: string[];
  /** What the page needs to tell tickets apart and to filter them; the engine routes on none of it. */
  boardId: string; complexity: string | null; favorite: boolean; blocked: boolean;
}
