/**
 * Turns `fleex documentation --format json` into Anthropic tools the assistant
 * can call, and back into an argv for the CLI. No shell, no quoting: every
 * value is its own argv element, so there is no injection surface.
 *
 * The CLI is the assistant's only hand on Fleex. Read commands run freely;
 * mutating ones too, except the destructive leaves (delete, remove, stop…),
 * which stay the user's.
 */

export interface CliCommandDoc {
  path: string; // "fleex ticket show"
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean; variadic: boolean }>;
  options: Array<{ flags: string; description: string; required: boolean; mandatory: boolean }>;
  subcommands: string[];
}

export interface CliToolOption {
  key: string;
  flag: string;
  takesValue: boolean;
  description: string;
}

export interface CliTool {
  name: string;
  commandPath: string[];
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
  arguments: Array<{ key: string; required: boolean; variadic: boolean }>;
  options: CliToolOption[];
  mutating: boolean;
  /** Never exposed: the user keeps these. */
  destructive: boolean;
  workspaceAware: boolean;
  jsonAware: boolean;
}

/** Command roots the assistant may use — the ticket-work surface, not instance admin. */
export const ASSISTANT_CLI_ROOTS = ['ticket', 'epic', 'board', 'panel', 'skill', 'routine', 'workflow', 'memory', 'repo', 'session', 'agent'] as const;

const MUTATING_LEAVES = new Set([
  'create', 'update', 'move', 'comment', 'add', 'set', 'run', 'start', 'link', 'attach', 'detach', 'assign',
  'archive', 'import', 'retry', 'resume', 'pause', 'tag', 'untag', 'favorite', 'unfavorite', 'block', 'unblock',
  'upload', 'rename', 'trigger', 'resolve', 'answer', 'approve', 'reject',
]);
const DESTRUCTIVE_LEAVES = new Set(['delete', 'remove', 'kill', 'stop', 'restart', 'self-update', 'prune', 'reset', 'purge']);
const HIDDEN_OPTIONS = new Set(['--help', '--workspace', '--json', '--format', '--version']);

/**
 * Tool property keys must match `^[a-zA-Z0-9_.-]{1,64}$`. CLI names like
 * `id|name`, `org/name` or `--with-comments` become `idOrName`, `orgName`,
 * `withComments`. Exported for tests.
 */
export function toKey(name: string): string {
  const words = name
    .replace(/^--/, '')
    .replace(/[<>[\]]/g, '')
    .replace(/\|/g, ' or ')
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return 'value';
  const key = words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('');
  return key.slice(0, 64);
}

function unique(key: string, taken: Set<string>): string {
  let k = key;
  for (let i = 2; taken.has(k); i++) k = `${key.slice(0, 60)}_${i}`;
  taken.add(k);
  return k;
}

/** "-b, --board <board>" → { flag: '--board', takesValue: true } */
export function parseFlags(flags: string): { flag: string; takesValue: boolean } | null {
  const long = flags.split(',').map((s) => s.trim()).find((s) => s.startsWith('--'));
  if (!long) return null;
  const flag = long.split(/\s+/)[0]!;
  const takesValue = /[<[]/.test(long);
  return { flag, takesValue };
}

export function buildCliTools(docs: readonly CliCommandDoc[], roots: readonly string[] = ASSISTANT_CLI_ROOTS): CliTool[] {
  const tools: CliTool[] = [];
  for (const doc of docs) {
    const parts = doc.path.split(/\s+/).slice(1); // drop "fleex"
    if (parts.length === 0 || !roots.includes(parts[0]!)) continue;
    if (doc.subcommands.length > 0) continue; // groups are not callable
    const leaf = parts[parts.length - 1]!;
    const destructive = DESTRUCTIVE_LEAVES.has(leaf);
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const taken = new Set<string>();
    const args = doc.arguments.map((a) => {
      const key = unique(toKey(a.name), taken);
      properties[key] = a.variadic
        ? { type: 'array', items: { type: 'string' }, description: a.description }
        : { type: 'string', description: a.description };
      if (a.required) required.push(key);
      return { key, required: a.required, variadic: a.variadic };
    });
    const options: CliToolOption[] = [];
    let workspaceAware = false;
    let jsonAware = false;
    for (const o of doc.options) {
      const parsed = parseFlags(o.flags);
      if (!parsed) continue;
      if (parsed.flag === '--workspace') { workspaceAware = true; continue; }
      if (parsed.flag === '--json') { jsonAware = true; continue; }
      if (HIDDEN_OPTIONS.has(parsed.flag)) continue;
      const key = unique(toKey(parsed.flag), taken);
      properties[key] = parsed.takesValue
        ? { type: 'string', description: o.description }
        : { type: 'boolean', description: o.description };
      options.push({ key, flag: parsed.flag, takesValue: parsed.takesValue, description: o.description });
    }
    tools.push({
      name: `fleex_${parts.join('_').replace(/-/g, '_')}`,
      commandPath: parts,
      description: `${doc.description} (CLI: ${doc.path})`,
      inputSchema: { type: 'object', properties, required },
      arguments: args,
      options,
      mutating: MUTATING_LEAVES.has(leaf),
      destructive,
      workspaceAware,
      jsonAware,
    });
  }
  return tools.filter((t) => !t.destructive);
}

/** @throws when a required positional is missing or a value has the wrong type. */
export function cliToolArgv(tool: CliTool, input: Record<string, unknown>, workspace: string | null): string[] {
  const argv = [...tool.commandPath];
  for (const a of tool.arguments) {
    const v = input[a.key];
    if (v === undefined || v === null || v === '') {
      if (a.required) throw new Error(`missing required argument: ${a.key}`);
      continue;
    }
    if (a.variadic) {
      if (!Array.isArray(v)) throw new Error(`argument ${a.key} must be an array`);
      for (const x of v) argv.push(String(x));
    } else {
      argv.push(String(v));
    }
  }
  for (const o of tool.options) {
    const v = input[o.key];
    if (v === undefined || v === null) continue;
    if (!o.takesValue) {
      if (v === true) argv.push(o.flag);
      continue;
    }
    argv.push(o.flag, String(v));
  }
  if (tool.workspaceAware && workspace) argv.push('--workspace', workspace);
  if (tool.jsonAware) argv.push('--json');
  return argv;
}

/** Anthropic `tools` entries for the CLI surface. */
export function cliToolsToAnthropic(tools: readonly CliTool[]): Array<{ name: string; description: string; input_schema: CliTool['inputSchema'] }> {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}
