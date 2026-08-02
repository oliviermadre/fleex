/**
 * Derives MCP tools from the fleex CLI Commander tree.
 *
 * Pure and dependency-light (only Commander *types*): pass a built `Command`
 * root and get back one `GeneratedTool` per actionable leaf command. This is
 * the same introspection `fleex documentation` performs — reusing the live
 * command tree means new CLI commands become tools with zero extra wiring.
 */
import type { Command, Option, Argument } from 'commander';
import type { ArgSpec, GeneratedTool, GenerateOptions, JsonSchema, JsonSchemaProp, OptSpec } from './types.ts';

/** Top-level groups exposed by default. Infra commands stay off the surface. */
export const DEFAULT_INCLUDE = ['ticket', 'epic'] as const;

/**
 * Leaf command names that ONLY read state.
 *
 * The classification is a security control — the side panel gates on it and it
 * drives MCP `readOnlyHint` — so it must fail CLOSED: anything not listed here
 * is treated as mutating. Over-gating a new read command costs one confirmation
 * dialog; under-gating a new write command is a prompt-injection hole.
 */
const READ_ONLY_LEAVES = new Set([
  // generic read verbs
  'list', 'ls', 'show', 'view', 'get', 'status', 'logs', 'documentation',
  // noun-shaped listings (`ticket comments`, `repo branches`, …)
  'boards', 'comments', 'mentions', 'branches', 'worktrees', 'issues', 'pr',
]);

/**
 * Leaf name segments that destroy state. Matched per-segment because the verb
 * can sit at either end: `comment-delete` → [comment, DELETE],
 * `remove-board` → [REMOVE, board].
 */
const DESTRUCTIVE_SEGMENTS = new Set([
  'delete', 'rm', 'remove', 'unlink', 'unregister', 'unexport', 'revoke', 'kill',
]);

/** `comment-delete` → ['comment', 'delete'] */
export function leafSegments(name: string): string[] {
  return name.split('-').filter(Boolean);
}

/** Fail-closed: an unknown leaf is assumed to mutate state. */
export function isMutatingLeaf(name: string): boolean {
  return !READ_ONLY_LEAVES.has(name);
}

/** True when the leaf destroys state (drives MCP `destructiveHint`). */
export function isDestructiveLeaf(name: string): boolean {
  return leafSegments(name).some((s) => DESTRUCTIVE_SEGMENTS.has(s));
}

/**
 * Commands whose server-side work legitimately exceeds the default budget.
 * Keyed by command path. `ticket link` awaits a git worktree creation plus
 * post-checkout hooks; `ticket import` does GitHub round-trips.
 */
const TOOL_TIMEOUTS_MS: Record<string, number> = {
  'ticket link': 300_000,
  'ticket import': 120_000,
};

/** Options we never expose as tool params (handled specially or noise). */
const HIDDEN_OPTION_LONGS = new Set(['--help', '--workspace', '--json']);

/**
 * Confirmation-skip flags. Host-controlled, never model-controlled: exposing
 * them in the input schema would let the model wave away the CLI's own guard.
 */
const CONFIRM_OPTION_ATTRS = new Set(['force', 'yes']);

function camelCase(name: string): string {
  return name.replace(/[-_\s]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Minimal walk of the Commander tree (root included), self-contained. */
function walk(root: Command): Array<{ cmd: Command; rel: string[] }> {
  const out: Array<{ cmd: Command; rel: string[] }> = [];
  const recurse = (cmd: Command, rel: string[]): void => {
    out.push({ cmd, rel });
    for (const sub of cmd.commands) {
      if (sub.name() === 'help') continue;
      recurse(sub, [...rel, sub.name()]);
    }
  };
  recurse(root, []);
  return out;
}

function isLeaf(cmd: Command): boolean {
  return cmd.commands.filter((c) => c.name() !== 'help').length === 0;
}

function readArguments(cmd: Command): ArgSpec[] {
  const raw = cmd as unknown as { registeredArguments?: Argument[]; _args?: Argument[] };
  const list: Argument[] = (raw.registeredArguments ?? raw._args ?? []) as Argument[];
  return list.map((a) => ({
    key: camelCase(a.name()),
    required: (a as unknown as { required?: boolean }).required ?? false,
    variadic: (a as unknown as { variadic?: boolean }).variadic ?? false,
  }));
}

function readOptions(cmd: Command): OptSpec[] {
  const specs: OptSpec[] = [];
  for (const o of cmd.options as Option[]) {
    if (o.negate) continue; // `--no-x` is covered by the positive `--x` boolean
    if (o.long && HIDDEN_OPTION_LONGS.has(o.long)) continue;
    if (CONFIRM_OPTION_ATTRS.has(o.attributeName())) continue; // host-controlled
    const flag = o.long ?? o.short;
    if (!flag) continue;
    const takesValue = Boolean(o.required || o.optional);
    // Commander marks `<v...>` as variadic, but the common repeatable pattern
    // `.option('--tag <t>', desc, collectFn, [])` is not — its only signal is an
    // array default. Treat either as array-valued.
    const variadic = Boolean(o.variadic) || Array.isArray((o as unknown as { defaultValue?: unknown }).defaultValue);
    specs.push({ key: o.attributeName(), flag, takesValue, variadic });
  }
  return specs;
}

function buildSchema(cmd: Command, args: ArgSpec[], options: OptSpec[]): JsonSchema {
  const properties: Record<string, JsonSchemaProp> = {};
  const required: string[] = [];

  const rawArgs = cmd as unknown as { registeredArguments?: Argument[]; _args?: Argument[] };
  const argList: Argument[] = (rawArgs.registeredArguments ?? rawArgs._args ?? []) as Argument[];
  args.forEach((a, i) => {
    const desc = argList[i]?.description || undefined;
    properties[a.key] = a.variadic
      ? { type: 'array', items: { type: 'string' }, ...(desc ? { description: desc } : {}) }
      : { type: 'string', ...(desc ? { description: desc } : {}) };
    if (a.required) required.push(a.key);
  });

  for (const o of cmd.options as Option[]) {
    if (o.negate || (o.long && HIDDEN_OPTION_LONGS.has(o.long))) continue;
    if (CONFIRM_OPTION_ATTRS.has(o.attributeName())) continue; // host-controlled
    const spec = options.find((s) => s.flag === (o.long ?? o.short));
    if (!spec) continue;
    const desc = o.description || undefined;
    if (!spec.takesValue) {
      properties[spec.key] = { type: 'boolean', ...(desc ? { description: desc } : {}) };
    } else if (spec.variadic) {
      properties[spec.key] = { type: 'array', items: { type: 'string' }, ...(desc ? { description: desc } : {}) };
    } else {
      properties[spec.key] = { type: 'string', ...(desc ? { description: desc } : {}) };
    }
    if (o.mandatory) required.push(spec.key);
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

function isWorkspaceAware(cmd: Command): boolean {
  return (cmd.options as Option[]).some((o) => o.long === '--workspace');
}

/**
 * Generate the full set of MCP tools from a built fleex Commander root.
 */
export function generateTools(root: Command, opts: GenerateOptions = {}): GeneratedTool[] {
  const include = new Set(opts.include ?? DEFAULT_INCLUDE);
  const tools: GeneratedTool[] = [];

  for (const { cmd, rel } of walk(root)) {
    if (rel.length === 0) continue; // skip root
    if (!include.has(rel[0]!)) continue; // allowlist by top-level group
    if (!isLeaf(cmd)) continue; // parent groups are not callable tools

    const args = readArguments(cmd);
    const options = readOptions(cmd);
    // Read the raw option list: confirm flags are filtered out of `options` on
    // purpose, but the executor still needs to know which flag to inject.
    const confirmOpt = (cmd.options as Option[]).find((o) => !o.negate && CONFIRM_OPTION_ATTRS.has(o.attributeName()));
    const confirmFlag = confirmOpt?.long ?? confirmOpt?.short;
    const timeoutMs = TOOL_TIMEOUTS_MS[rel.join(' ')];
    tools.push({
      name: ['fleex', ...rel].join('_').replace(/-/g, '_'),
      commandPath: rel,
      description: cmd.description() || rel.join(' '),
      inputSchema: buildSchema(cmd, args, options),
      mutating: isMutatingLeaf(cmd.name()),
      workspaceAware: isWorkspaceAware(cmd),
      ...(confirmFlag ? { confirmFlag } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      arguments: args,
      options,
    });
  }

  return tools;
}
