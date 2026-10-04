import type { ActionRun } from './pinned-actions.js';

/**
 * Worktree actions — the per-worktree button of the Work top bar (WORKTREES
 * group) and its launcher menu: start / stop / open the worktree's dev server,
 * and run any command of the repo (its own actions, `.claude/launch.json`
 * configurations, package.json scripts, Makefile targets, composer scripts).
 *
 * The config is read from four layers, strongest first:
 *   1. personal  — `app_config.worktreeConfigs["org/name"]`, in Fleex;
 *   2. shared    — `<worktree>/.fleex/worktree.json`, committed with the repo;
 *   3. launch    — `<worktree>/.claude/launch.json`, read only, never written;
 *   4. detected  — package.json / Makefile / composer.json, read only.
 */

/** What the worktree's dev server is doing. */
export type WorktreeServerState = 'stopped' | 'starting' | 'running' | 'error';

export const WORKTREE_SERVER_STATES: readonly WorktreeServerState[] = ['stopped', 'starting', 'running', 'error'];

/** Where a menu item comes from. `action` = declared in a config layer. */
export type WorktreeItemSource = 'action' | 'launch' | 'npm' | 'make' | 'composer';

/** Sources that are detected from repo files (the `discovery.sources` values). */
export type WorktreeDiscoverySource = 'launch' | 'npm' | 'make' | 'composer';

export const WORKTREE_DISCOVERY_SOURCES: readonly WorktreeDiscoverySource[] = ['launch', 'npm', 'make', 'composer'];

/** Which config layer an item was resolved from. */
export type WorktreeConfigLayer = 'personal' | 'shared' | 'launch' | 'detected';

export type WorktreeRunMode = 'background' | 'terminal';

/** Server verbs, available on every worktree whatever its config. */
export type WorktreeVerb = 'start' | 'stop' | 'restart' | 'open' | 'logs' | 'status';

export const WORKTREE_VERBS: readonly WorktreeVerb[] = ['start', 'stop', 'restart', 'open', 'logs', 'status'];

/** An action declared in a config layer (`actions[]`). */
export interface WorktreeActionDef {
  id: string;
  label?: string;
  /** A shell command, or a reference to a detected item (`npm:dev`, `make:up`, `launch:web`). */
  cmd: string;
  /** Default `terminal` for detected items, `background` for declared actions. */
  mode?: WorktreeRunMode;
  /** Server states in which the action is offered. Absent/empty = always. */
  when?: WorktreeServerState[];
  /** Personal layer only: hide the shared action of the same id. */
  hidden?: boolean;
}

/** `'menu'` opens the menu; else a verb or an item id. */
export type WorktreeClickChoice = WorktreeVerb | 'menu' | (string & {});

export interface WorktreeServerConfig {
  /** A shell command, or a reference (`launch:web`, `npm:dev`, `make:up`). */
  start?: string;
  /** Optional: without it, Stop kills the start command's terminal session. */
  stop?: string;
  probe?: { command: string; intervalSec?: number };
  /** `${port}` is replaced by the detected port. */
  url?: string;
  clickByState?: Partial<Record<WorktreeServerState, WorktreeClickChoice>>;
}

/** Same shape for `.fleex/worktree.json` and the personal layer. */
export interface WorktreeConfig {
  version?: number;
  hooks?: {
    /** Run in each new worktree (formerly the repo's post-checkout hook). */
    setup?: string;
    teardown?: string;
    timeoutSec?: number;
  };
  server?: WorktreeServerConfig;
  actions?: WorktreeActionDef[];
  /** Item ids shown in the ★ group. Personal and shared pins add up. */
  pins?: string[];
  discovery?: { sources?: WorktreeDiscoverySource[]; hide?: string[] };
  ports?: { reserve?: boolean; count?: number };
}

/** One runnable line of the menu, after the layers are merged. */
export interface WorktreeActionItem {
  /** `npm:test`, `make:up`, `launch:web`, `composer:serve`, or a declared action's id. */
  id: string;
  source: WorktreeItemSource;
  layer: WorktreeConfigLayer;
  label: string;
  /** The shell command that runs (references resolved). */
  command: string;
  mode: WorktreeRunMode;
  /** Relative to the worktree (launch.json `cwd`). Absent = the worktree root. */
  cwd?: string;
  /** Extra environment (launch.json `env`). */
  env?: Record<string, string>;
  /** launch.json `port` / `url`. */
  port?: number;
  url?: string;
  when?: WorktreeServerState[];
  pinned: boolean;
}

export interface WorktreeServerSnapshot {
  /** Absolute worktree path. */
  path: string;
  state: WorktreeServerState;
  /** Port the server listens on (detected, else the launch.json port once it answers). */
  port?: number;
  url?: string;
  /** The start command's run, while it is alive. */
  runId?: string;
  tmuxSession?: string;
  /** Exit code of the start command, when it ended. */
  exitCode?: number;
  /** ISO timestamp of the last change. */
  updatedAt: string;
}

export interface WorktreeActionsView {
  path: string;
  /** `org/name`, null when the worktree has no resolvable remote. */
  repo: string | null;
  branch: string;
  items: WorktreeActionItem[];
  /** The start target, or null when nothing can start the server. */
  start: { id?: string; command: string; label: string } | null;
  clickByState: Record<WorktreeServerState, WorktreeClickChoice>;
  server: WorktreeServerSnapshot;
  /** `.fleex/worktree.json` was present but could not be parsed. */
  sharedConfigError?: string;
}

export interface WorktreeActionsListResponse {
  worktrees: WorktreeActionsView[];
}

export interface WorktreeRunRequest {
  path: string;
  /** Exactly one of id / verb. */
  id?: string;
  verb?: WorktreeVerb;
}

export interface WorktreeRunResponse {
  /** The run started (or already running, `alreadyRunning`). */
  runId?: string;
  alreadyRunning?: boolean;
  /** The run record, when one was started. */
  run?: ActionRun;
  /** `open`: where to go. */
  url?: string;
  server: WorktreeServerSnapshot;
}

export type WorktreeActionsWsMessage = { type: 'worktree-server:update'; data: WorktreeServerSnapshot };

export const DEFAULT_WORKTREE_CLICK: Record<WorktreeServerState, WorktreeClickChoice> = {
  stopped: 'start',
  starting: 'logs',
  running: 'open',
  error: 'logs',
};

/** Configured left click per state, missing states falling back to the defaults. */
export function worktreeClickByState(
  config: Partial<Record<WorktreeServerState, WorktreeClickChoice>> | undefined,
): Record<WorktreeServerState, WorktreeClickChoice> {
  return { ...DEFAULT_WORKTREE_CLICK, ...Object.fromEntries(Object.entries(config ?? {}).filter(([, v]) => typeof v === 'string' && v)) };
}

export function isWorktreeVerb(value: string): value is WorktreeVerb {
  return (WORKTREE_VERBS as readonly string[]).includes(value);
}

/** True when the item is offered in the menu for `state` (same rule as `inMenuFor`). */
export function worktreeItemOffered(item: Pick<WorktreeActionItem, 'when'>, state: WorktreeServerState): boolean {
  return !item.when?.length || item.when.includes(state);
}

/** Session id used for the worktree's runs: one per worktree, stable across restarts. */
export function worktreeSourceId(path: string): string {
  // FNV-1a: short, deterministic, no crypto dependency (shared runs in the browser too).
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `wt:${h.toString(36)}`;
}

/** The run slot of the server's start command. */
export const WORKTREE_START_SLOT = 'start';
