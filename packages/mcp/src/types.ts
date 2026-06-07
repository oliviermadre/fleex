/**
 * Shared types for the Fleex MCP tool surface.
 *
 * A `GeneratedTool` is derived deterministically from one leaf command of the
 * fleex CLI Commander tree. The fields below carry everything needed to (a)
 * present the tool to an LLM (`name`, `description`, `inputSchema`), (b) gate it
 * (`mutating`), and (c) rebuild the exact `fleex` argv from a tool-call input
 * (`arguments`, `options`, `workspaceAware`).
 */

export interface JsonSchemaProp {
  type: 'string' | 'boolean' | 'array';
  description?: string;
  items?: { type: 'string' };
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProp>;
  required: string[];
  additionalProperties: false;
}

/** A positional CLI argument (e.g. `<id>` in `ticket move <id> <status>`). */
export interface ArgSpec {
  /** Schema/input key (camelCased argument name). */
  key: string;
  required: boolean;
  variadic: boolean;
}

/** A CLI option (e.g. `--title <t>` or boolean `--favorite`). */
export interface OptSpec {
  /** Schema/input key (Commander attributeName, camelCased, no `--no-`). */
  key: string;
  /** Canonical long flag used when rebuilding argv, e.g. `--to-board`. */
  flag: string;
  /** Whether the option consumes a value (`<v>`/`[v]`) vs. being a boolean. */
  takesValue: boolean;
  variadic: boolean;
}

export interface GeneratedTool {
  /** Tool name exposed to the model, e.g. `fleex_ticket_create`. */
  name: string;
  /** Command path relative to root, e.g. `['ticket', 'create']`. */
  commandPath: string[];
  description: string;
  inputSchema: JsonSchema;
  /** True for create/update/move/delete/... — the host should gate these. */
  mutating: boolean;
  /** True when the command accepts `--workspace`; injected by the host. */
  workspaceAware: boolean;
  /**
   * Flag that skips an interactive confirmation prompt (e.g. `--force` on
   * delete). When present, executors inject it so the non-interactive CLI
   * never blocks on stdin — human confirmation already happens at the host.
   */
  confirmFlag?: string;
  /** Ordered positional arguments (drives argv reconstruction). */
  arguments: ArgSpec[];
  /** Options (drives argv reconstruction). */
  options: OptSpec[];
}

export interface GenerateOptions {
  /**
   * Top-level command groups to expose (allowlist). Defaults to the domain
   * surface; infra commands (start/stop/logs/…) are never exposed.
   */
  include?: string[];
}
