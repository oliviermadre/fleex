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

function readOptions(cmd: Command): OptSpec[] {
  const specs: OptSpec[] = [];
  for (const o of cmd.options as Option[]) {
    if (o.negate) continue; // `--no-x` is covered by the positive `--x` boolean
    if (o.long && HIDDEN_OPTION_LONGS.has(o.long)) continue;
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
      options,
    });
  }

  return tools;
}
