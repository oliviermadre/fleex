/**
 * Declared action registry.
 *
 * Replaces the free-form `POST /api/exec` endpoint: the HTTP caller no longer
 * ships a command string, it names an `ActionDef.id` declared in the app config
 * and (optionally) supplies typed parameters. The server resolves the command
 * from its own config, so no HTTP body can ever introduce a new executable.
 */

export type ActionScope = 'global' | 'workspace';

/**
 * - `url`   — resolved and opened by the browser; never reaches the server.
 * - `exec`  — `execFile(command, argv)`. No shell, so an interpolated parameter
 *             can never be re-parsed into extra words/operators.
 * - `shell` — escape hatch for one-liners that genuinely need pipes or
 *             redirections. The script is frozen in config; dynamic values are
 *             passed as positional parameters (`$1`…`$n`), never concatenated.
 */
export type ActionKind = 'url' | 'exec' | 'shell';

export type ActionParamType = 'string' | 'number' | 'boolean' | 'enum';

export type ActionIconType = 'svg' | 'base64' | 'path' | 'url';

export interface ActionParamDef {
  /** Identifier used as `{{name}}` in `args`/`cwd`. Must match ACTION_PARAM_NAME_RE. */
  name: string;
  type: ActionParamType;
  required?: boolean;
  default?: string | number | boolean;
  /** Allowed values — required (and only meaningful) when `type: 'enum'`. */
  values?: string[];
  /** Anchored at validation time (`^…$`). Only meaningful when `type: 'string'`. */
  pattern?: string;
}

export interface ActionDef {
  id: string;
  label: string;
  scope: ActionScope;
  icon: string;
  iconType: ActionIconType;
  /** Defaults to true when absent. */
  enabled?: boolean;
  kind: ActionKind;

  /** kind='url' — may contain placeholders, resolved client-side. */
  url?: string;

  /** kind='exec' — literal program name/path. Placeholders are rejected. */
  command?: string;
  /** kind='exec' | 'shell' — each element may contain placeholders. */
  args?: string[];
  /** kind='exec' | 'shell' — may contain placeholders. */
  cwd?: string;

  /** kind='shell' — literal script. Placeholders are rejected; use `args` + `$1`. */
  script?: string;

  params?: ActionParamDef[];
  /** Clamped to [ACTION_TIMEOUT_MIN_MS, ACTION_TIMEOUT_MAX_MS]. */
  timeoutMs?: number;
}

export const ACTION_PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;

export const ACTION_DEFAULT_TIMEOUT_MS = 10_000;
export const ACTION_TIMEOUT_MIN_MS = 1_000;
export const ACTION_TIMEOUT_MAX_MS = 120_000;

/** Max bytes of stdout/stderr returned per run; beyond this the output is truncated. */
export const ACTION_OUTPUT_LIMIT_BYTES = 64 * 1024;

/**
 * Context variables derived server-side from the ticket. The client never
 * supplies these — it only names a ticket, the server resolves the paths.
 */
export const ACTION_CONTEXT_VARIABLES = [
  'workspace_path',
  'workspace_name',
  'ticket_id',
  'ticket_slug',
  'ticket_display_id',
] as const;

export type ActionContextVariable = (typeof ACTION_CONTEXT_VARIABLES)[number];

export interface RunActionRequest {
  /** Required when the action's scope is 'workspace'. */
  ticketId?: string;
  params?: Record<string, unknown>;
}

export interface RunActionResponse {
  runId: string;
  actionId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}
