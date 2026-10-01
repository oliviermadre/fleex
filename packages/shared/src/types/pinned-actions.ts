/**
 * Pinned actions (top bar) and workspace actions (ticket header) — the one-click
 * buttons configured in Settings › Actions.
 *
 * Both live in the `app_config` blob (`pinnedIcons`, `workspaceActions`); every
 * field added here is optional so a config written before it existed keeps
 * rendering and running exactly as it did.
 */

/**
 * What a status probe concluded.
 * `ko` means "you need to act" (red); `unknown` means "I could not tell" (grey).
 * The two are never conflated: a probe that timed out did not prove anything is
 * broken, so it must not paint the button red.
 */
export type ActionStatus = 'ok' | 'warn' | 'ko' | 'unknown';

export const ACTION_STATUSES: readonly ActionStatus[] = ['ok', 'warn', 'ko', 'unknown'];

export type ActionKind = 'url' | 'shell';

/**
 * Where a shell action runs. `background`: login, non-interactive zsh without a
 * TTY (no .zshrc), output streamed to the logs. `terminal`: an interactive zsh
 * (.zshrc loaded, real TTY) in a floating terminal the user can type into.
 * Absent = background. Probes are always background.
 */
export type ActionRunMode = 'background' | 'terminal';

export interface StatusProbe {
  /** Shell command run by the server through the gateway (`zsh -l -c`). */
  command: string;
  /** Seconds between two probes. Clamped to PROBE_MIN_INTERVAL_SEC server-side. */
  intervalSec: number;
  /** Default PROBE_DEFAULT_TIMEOUT_SEC, max PROBE_MAX_TIMEOUT_SEC. */
  timeoutSec?: number;
}

/** A click target chosen by the current status, evaluated before the default action. */
export interface ConditionalAction {
  id: string;
  /** Shown in the context menu and in the tooltip's "Click: …" line. */
  label: string;
  /** Statuses this rule applies to. Absent/empty = always eligible. */
  when?: ActionStatus[];
  actionType: ActionKind;
  actionValue: string;
  /** Shell only. Default ACTION_DEFAULT_TIMEOUT_SEC, max ACTION_MAX_TIMEOUT_SEC. */
  timeoutSec?: number;
  /** Overrides the action's run mode for this rule (e.g. interactive login, background logout). */
  runMode?: ActionRunMode;
}

export type ActionIconType = 'svg' | 'base64' | 'path' | 'url';

export interface PinnedIcon {
  id: string;
  icon: string;
  iconType: ActionIconType;
  label: string;
  /** The default action (used when no conditional action matches). */
  actionType: ActionKind;
  actionValue: string;
  /** Shell only. Default ACTION_DEFAULT_TIMEOUT_SEC. */
  actionTimeoutSec?: number;
  status?: StatusProbe;
  conditionalActions?: ConditionalAction[];
  /** Absent = true. A hidden action is neither shown nor probed. */
  enabled?: boolean;
  runMode?: ActionRunMode;
  /** Terminal mode: close the floating terminal 2 s after an exit 0. Never on failure. */
  closeTerminalOnSuccess?: boolean;
}

export interface WorkspaceAction {
  id: string;
  icon: string;
  iconType: ActionIconType;
  label: string;
  actionType: ActionKind;
  actionValue: string;
  actionTimeoutSec?: number;
  enabled?: boolean;
  runMode?: ActionRunMode;
  closeTerminalOnSuccess?: boolean;
}

export const PROBE_INTERVALS_SEC = [30, 60, 300, 900] as const;
export const PROBE_DEFAULT_INTERVAL_SEC = 60;
export const PROBE_MIN_INTERVAL_SEC = 15;
export const PROBE_DEFAULT_TIMEOUT_SEC = 10;
export const PROBE_MAX_TIMEOUT_SEC = 60;
export const ACTION_DEFAULT_TIMEOUT_SEC = 300;
export const ACTION_MAX_TIMEOUT_SEC = 1800;

/** Latest known state of one pinned icon's probe, pushed over the `pinned-status` channel. */
export interface StatusSnapshot {
  iconId: string;
  status: ActionStatus;
  tooltip?: string;
  badge?: string;
  /** ISO timestamp of the last finished probe; absent until the first one ends. */
  checkedAt?: string;
  durationMs?: number;
  probing: boolean;
}

/** How a probe result was read — shown by the Settings "Test" button. */
export type ProbeParseSource = 'json' | 'exit-code' | 'error';

export interface ProbeTestResult {
  snapshot: StatusSnapshot;
  source: ProbeParseSource;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ActionSourceKind = 'pinned' | 'workspace';

export interface ActionRunRequest {
  /** Pinned icon / workspace action id. `draft:<id>` for Settings "Try" runs. */
  sourceId: string;
  sourceKind: ActionSourceKind;
  label: string;
  /** Already resolved (workspace templates are expanded client-side). */
  command: string;
  cwd?: string;
  timeoutSec?: number;
  /** Resolved client-side (rule > action). Absent = background. */
  mode?: ActionRunMode;
}

export interface ActionRun {
  runId: string;
  sourceId: string;
  sourceKind: ActionSourceKind;
  label: string;
  command: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  timedOut?: boolean;
  stdout: string;
  stderr: string;
  /** Absent on runs recorded before run modes existed = background. */
  mode?: ActionRunMode;
  /** Stopped by the user (Stop, or the terminal was closed). */
  cancelled?: boolean;
  /** Terminal mode: the tmux session the floating terminal attaches to. */
  tmuxSession?: string;
  /** Background run executed without live output (gateway not restarted yet). */
  liveUnavailable?: boolean;
}

/** A batch of live output of a background run (≤ 16 KB, sent every 250 ms). */
export interface ActionRunOutputChunk {
  runId: string;
  sourceId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
  /** Monotonic per run — chunks may arrive out of order. */
  seq: number;
  /** Bytes produced since the previous chunk but not sent live (still in the final log). */
  dropped?: number;
}

/** What the running gateway supports; false until it has been restarted on a new build. */
export interface ActionRunCapabilities {
  liveOutput: boolean;
  terminal: boolean;
}

export type PinnedStatusWsMessage =
  | { type: 'pinned-status:snapshot'; data: StatusSnapshot[] }
  | { type: 'pinned-status:update'; data: StatusSnapshot }
  | { type: 'action-run:started'; data: ActionRun }
  | { type: 'action-run:finished'; data: ActionRun }
  | { type: 'action-run:output'; data: ActionRunOutputChunk };

/**
 * The first rule whose `when` contains the status (or that has no `when`) wins;
 * none matching → the default action. Shared so the tooltip announces exactly
 * what the click will do.
 */
export function resolveClickAction(
  icon: Pick<PinnedIcon, 'label' | 'actionType' | 'actionValue' | 'actionTimeoutSec' | 'conditionalActions' | 'status' | 'runMode'>,
  status: ActionStatus | null,
): { label: string; actionType: ActionKind; actionValue: string; timeoutSec?: number; runMode: ActionRunMode; rule: ConditionalAction | null } {
  if (icon.status && icon.conditionalActions?.length) {
    const rule = icon.conditionalActions.find(
      (r) => !r.when || r.when.length === 0 || (status !== null && r.when.includes(status)),
    );
    if (rule) {
      return { label: rule.label || rule.actionValue, actionType: rule.actionType, actionValue: rule.actionValue, timeoutSec: rule.timeoutSec, runMode: rule.runMode ?? icon.runMode ?? 'background', rule };
    }
  }
  return {
    label: icon.label,
    actionType: icon.actionType,
    actionValue: icon.actionValue,
    timeoutSec: icon.actionTimeoutSec,
    runMode: icon.runMode ?? 'background',
    rule: null,
  };
}

// ─── Actions AI assistants ───────────────────────────────────────────────────

export type ActionsAiCommandKind = 'action' | 'probe' | 'rule';
export type ActionScope = 'pinned' | 'ticket';
export type CommandRisk = 'safe' | 'mutating' | 'destructive';

export interface ActionsAiCommandRequest {
  intent: string;
  kind: ActionsAiCommandKind;
  scope: ActionScope;
  context?: { label?: string; currentCommand?: string; defaultCommand?: string; probeCommand?: string };
  /** Commands already proposed, so "Other" yields something different. */
  exclude?: string[];
}

export interface BinaryCheck {
  name: string;
  found: boolean;
  path?: string;
  /** Defined in .zshrc only: found in your terminal, not by a background action. */
  kind?: 'alias' | 'function';
}

export interface ActionsAiCommandSuggestion {
  command: string;
  explanation: string;
  risk: CommandRisk;
  binaries: BinaryCheck[];
  alternatives?: string[];
  /** Interactive command (prompt, -it, login without --web): run it in a terminal. */
  runMode?: ActionRunMode;
}

export type IconSource = 'simple-icons' | 'lucide' | 'tabler' | 'generated';

export interface IconSuggestion {
  id: string;
  source: IconSource;
  name: string;
  /** Sanitised, self-contained SVG markup. */
  svg: string;
  license: string;
}

export interface ActionsAiIconsRequest {
  label: string;
  command?: string;
  probeCommand?: string;
  exclude?: string[];
}

export interface ActionsAiIconsResponse {
  keywords: string[];
  suggestions: IconSuggestion[];
  /** True when Iconify could not be reached and only generated icons are offered. */
  iconifyUnavailable?: boolean;
}

export interface ActionsAiDraftRequest {
  prompt: string;
  scope: ActionScope;
}

export type ActionsAiDraftStage = 'intent' | 'command' | 'probe' | 'icon';

export interface ActionsAiDraft {
  label: string;
  actionType: ActionKind;
  actionValue: string;
  status?: StatusProbe;
  conditionalActions?: ConditionalAction[];
}

export interface ActionsAiDraftResult {
  draft: ActionsAiDraft;
  icon: IconSuggestion | null;
  notes?: string;
}

export type ActionsAiDraftEvent =
  | { stage: ActionsAiDraftStage }
  | ActionsAiDraftResult
  | { error: string };
