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

/**
 * Top-level groups exposed by default.
 *
 * Inclusion criterion: **the command manipulates product data (tickets, epics)
 * through the API and has no effect on the local environment.** Infra commands
 * (`start`, `stop`, `logs`, `doctor`, `self-update`, `token`, shell helpers)
 * drive processes on the host machine and stay off the surface on purpose.
 *
 * The parity guarantee this package makes is about *options*, not perimeter:
 * every option of an included command must be reachable from a tool call (see
 * `tests/parity.bun.test.ts`). Narrowing the perimeter is a deliberate product
 * decision; silently dropping an option is a bug.
 */
export const DEFAULT_INCLUDE = ['ticket', 'epic'] as const;

/**
 * Leaf command names that mutate state. The host gates these (e.g. asks the
 * user to confirm) since the assistant ingests untrusted page content.
 */
const MUTATING_LEAVES = new Set([
  'create', 'new', 'update', 'move', 'delete', 'rm', 'remove',
  'add', 'link', 'unlink', 'import', 'comment', 'edit', 'archive', 'unarchive',
]);

/** Options we never expose as tool params (handled specially or noise). */
const HIDDEN_OPTION_LONGS = new Set(['--help', '--workspace', '--json']);

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

/** An option spec enriched with what `buildSchema` needs. Internal to this module. */
interface OptInfo extends OptSpec {
  description?: string;
  mandatory: boolean;
}

/**
 * Read a command's options, pairing each `--no-x` with its positive `--x`.
 *
 * A boolean CLI option has three meaningful states from a tool call — set,
 * unset, untouched — so a `--no-x` declaration is NOT redundant with `--x`:
 * it is the only way to express "unset". Dropping it (as this function used
 * to) made options like `--no-blocked` unreachable for an agent. Both the
 * schema and the argv reconstruction derive from this single pass, so they
 * cannot diverge.
 */
function readOptions(cmd: Command): OptInfo[] {
  const positives = new Map<string, OptInfo>();
  const negatives: Option[] = [];
  const order: string[] = [];

  for (const o of cmd.options as Option[]) {
    if (o.long && HIDDEN_OPTION_LONGS.has(o.long)) continue;
    const flag = o.long ?? o.short;
    if (!flag) continue;
    if (o.negate) {
      negatives.push(o);
      continue;
    }
    const takesValue = Boolean(o.required || o.optional);
    // Commander marks `<v...>` as variadic, but the common repeatable pattern
    // `.option('--tag <t>', desc, collectFn, [])` is not — its only signal is an
    // array default. Treat either as array-valued.
    const variadic = Boolean(o.variadic) || Array.isArray((o as unknown as { defaultValue?: unknown }).defaultValue);
    const key = o.attributeName();
    positives.set(key, {
      key,
      flag,
      takesValue,
      variadic,
      mandatory: Boolean(o.mandatory),
      ...(o.description ? { description: o.description } : {}),
    });
    order.push(key);
  }

  for (const o of negatives) {
    const key = o.attributeName();
    const flag = o.long ?? o.short;
    if (!flag) continue;
    const positive = positives.get(key);
    if (positive) {
      // Paired: one tri-state boolean param. Describe BOTH directions, otherwise
      // the model reads "Mark as blocked" and never guesses it can pass false.
      positive.negateFlag = flag;
      positive.description = positive.description
        ? `${positive.description} (false: ${lowerFirst(o.description || `pass ${flag}`)})`
        : o.description || undefined;
      continue;
    }
    // Declared only in negative form (e.g. `--no-color`): expose it as a boolean
    // that accepts `false`. Without this the option vanishes from the surface.
    positives.set(key, {
      key,
      flag,
      takesValue: false,
      variadic: false,
      negateOnly: true,
      mandatory: false,
      description: `${o.description || `pass ${flag}`} (set false to apply)`,
    });
    order.push(key);
  }

  return order.map((k) => positives.get(k)!);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Drop the schema-only fields; `GeneratedTool.options` drives argv rebuilding. */
function toSpec(o: OptInfo): OptSpec {
  const { description: _d, mandatory: _m, ...spec } = o;
  return spec;
}

function buildSchema(cmd: Command, args: ArgSpec[], options: OptInfo[]): JsonSchema {
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

  // Options come from the single `readOptions` pass — no second, divergent filter.
  for (const spec of options) {
    const desc = spec.description;
    if (!spec.takesValue) {
      properties[spec.key] = { type: 'boolean', ...(desc ? { description: desc } : {}) };
    } else if (spec.variadic) {
      properties[spec.key] = { type: 'array', items: { type: 'string' }, ...(desc ? { description: desc } : {}) };
    } else {
      properties[spec.key] = { type: 'string', ...(desc ? { description: desc } : {}) };
    }
    if (spec.mandatory) required.push(spec.key);
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
    const confirmFlag = options.find((o) => o.key === 'force' || o.key === 'yes')?.flag;
    tools.push({
      name: ['fleex', ...rel].join('_').replace(/-/g, '_'),
      commandPath: rel,
      description: cmd.description() || rel.join(' '),
      inputSchema: buildSchema(cmd, args, options),
      mutating: MUTATING_LEAVES.has(cmd.name()),
      workspaceAware: isWorkspaceAware(cmd),
      ...(confirmFlag ? { confirmFlag } : {}),
      arguments: args,
      options: options.map(toSpec),
    });
  }

  return tools;
}
