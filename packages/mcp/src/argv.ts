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

/**
 * @throws if a required positional argument is missing from `input`.
 */
export function buildArgv(
  tool: GeneratedTool,
  input: Record<string, unknown>,
  opts: BuildArgvOptions = {},
): string[] {
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
      if (value === true) argv.push(opt.flag);
      continue;
    }
    if (opt.variadic) {
      if (!Array.isArray(value)) throw new Error(`option ${opt.key} must be an array`);
      for (const v of value) argv.push(opt.flag, asString(v));
    } else {
      argv.push(opt.flag, asString(value));
    }
  }

  if (tool.workspaceAware && opts.workspace) argv.push('--workspace', opts.workspace);
  if (opts.assumeYes && tool.confirmFlag && !argv.includes(tool.confirmFlag))
    argv.push(tool.confirmFlag);
  if (opts.json) argv.push('--json');

  return argv;
}
