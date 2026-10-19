/**
 * Rebuilds the exact `fleex` argv for a tool call from its input object.
 *
 * Pure and deterministic. Each value becomes its own argv element (no shell,
 * no quoting) so multi-line content — e.g. a page rendered to Markdown passed
 * as `--description` — survives intact and there is no injection surface.
 */
import type { GeneratedTool } from './types.ts';

export interface BuildArgvOptions {
  /** Workspace name; injected as `--workspace <name>` for workspace-aware tools. */
  workspace?: string;
  /** Append `--json` to request structured CLI output (read commands). */
  json?: boolean;
  /**
   * Inject the tool's confirmation-skip flag (e.g. `--force`) so the CLI never
   * blocks on an interactive prompt. Set by executors after the host has
   * already obtained human approval.
   */
  assumeYes?: boolean;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`expected a string value, got ${typeof value}`);
}

/** Host-owned flags a model may still send; ignoring them would run elsewhere. */
const RESERVED_FIELDS: Record<string, string> = {
  workspace: 'the workspace is set by the host, remove this field',
  json: 'JSON output is always on, remove this field',
};

const normalize = (s: string): string => s.toLowerCase().replace(/[_-]/g, '');

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Best guess for a misnamed field, or undefined. Rules in order, first hit
 * wins (ties → first accepted field): normalized equality; prefix either way
 * (shorter ≥ 3 chars); Levenshtein ≤ 2 (both ≥ 4 chars).
 */
export function suggestField(unknown: string, accepted: string[]): string | undefined {
  const u = normalize(unknown);
  const rules: Array<(a: string) => boolean> = [
    (a) => a === u,
    (a) => Math.min(a.length, u.length) >= 3 && (a.startsWith(u) || u.startsWith(a)),
    (a) => a.length >= 4 && u.length >= 4 && levenshtein(u, a) <= 2,
  ];
  for (const rule of rules) {
    const hit = accepted.find((a) => rule(normalize(a)));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Reject every input key the tool does not declare. Neither the MCP server nor
 * the side panel validates `additionalProperties:false`, so an ignored key
 * (`state` for `status`) used to return an unfiltered result as a success.
 * All offenders are reported at once so the caller fixes them in one retry.
 */
function assertKnownFields(tool: GeneratedTool, input: Record<string, unknown>): void {
  const accepted = [...tool.arguments.map((a) => a.key), ...tool.options.map((o) => o.key)];
  const known = new Set(accepted);
  const lines: string[] = [];
  for (const key of Object.keys(input)) {
    if (known.has(key) || input[key] === undefined) continue;
    let line = `unknown field "${key}" for ${tool.name}`;
    const reserved = Object.hasOwn(RESERVED_FIELDS, key) ? RESERVED_FIELDS[key] : undefined;
    const suggestion = reserved ? undefined : suggestField(key, accepted);
    if (reserved) line += ` — ${reserved}`;
    else if (suggestion) line += ` — did you mean "${suggestion}"?`;
    lines.push(line);
  }
  if (lines.length === 0) return;
  lines.push(`accepted fields: ${accepted.length ? accepted.join(', ') : '(none)'}`);
  throw new Error(lines.join('\n'));
}

/**
 * @throws if `input` carries a key the tool does not declare, or a required
 *   positional argument is missing.
 */
export function buildArgv(
  tool: GeneratedTool,
  input: Record<string, unknown>,
  opts: BuildArgvOptions = {},
): string[] {
  assertKnownFields(tool, input);
  const argv: string[] = [...tool.commandPath];

  // Positional arguments, in declaration order.
  for (const arg of tool.arguments) {
    const value = input[arg.key];
    if (value === undefined || value === null) {
      if (arg.required) throw new Error(`missing required argument: ${arg.key}`);
      continue;
    }
    if (arg.variadic) {
      if (!Array.isArray(value)) throw new Error(`argument ${arg.key} must be an array`);
      for (const v of value) argv.push(asString(v));
    } else {
      argv.push(asString(value));
    }
  }

  // Options.
  for (const opt of tool.options) {
    const value = input[opt.key];
    if (value === undefined || value === null) continue;
    if (!opt.takesValue) {
      // A boolean has three states: set, unset, untouched. `false` must never be
      // silently dropped — that used to make the call look empty to the CLI.
      if (value === true) {
        if (opt.negateOnly) {
          throw new Error(`option ${opt.key} only accepts false (the CLI declares ${opt.flag})`);
        }
        argv.push(opt.flag);
      } else if (value === false) {
        if (!opt.negateFlag && !opt.negateOnly) {
          throw new Error(`option ${opt.key} cannot be unset (the CLI declares no --no-… flag for it)`);
        }
        argv.push(opt.negateFlag ?? opt.flag);
      } else {
        throw new Error(`option ${opt.key} expects a boolean, got ${typeof value}`);
      }
      continue;
    }
    if (opt.variadic) {
      // A repeatable option is an array, but a lone string is an unambiguous
      // singleton — absorb it rather than failing the whole call.
      const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
      if (!list) {
        throw new Error(`option ${opt.key} expects a string or an array of strings, got ${typeof value}`);
      }
      for (const v of list) argv.push(opt.flag, asString(v));
    } else {
      argv.push(opt.flag, asString(value));
    }
  }

  if (tool.workspaceAware && opts.workspace) argv.push('--workspace', opts.workspace);
  if (opts.assumeYes && tool.confirmFlag && !argv.includes(tool.confirmFlag)) argv.push(tool.confirmFlag);
  if (opts.json) argv.push('--json');

  return argv;
}
