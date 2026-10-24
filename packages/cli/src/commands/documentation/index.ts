/**
 * `fleex documentation` — exhaustive, self-describing dump of every command
 * the CLI exposes, intended primarily for LLM-driven discovery.
 *
 * Why this exists:
 * - A single command lists EVERYTHING (commands, subcommands, args, options,
 *   aliases, descriptions). Drop the output into a prompt and the model can
 *   reason about the whole CLI surface.
 * - It MUST stay zero-maintenance: this file does not enumerate commands
 *   itself, it walks Commander's tree. Adding `src/commands/foo/index.ts`
 *   makes `foo` appear here automatically with no edit to this file.
 *
 * Output formats:
 *   --format markdown   (default) human + LLM friendly
 *   --format json       structured, easiest for programmatic consumers
 *   --format text       plain text, no markdown syntax
 */
import { Command, type Option, type Argument } from 'commander';
import type { CommandDef } from '../../core/types.ts';
import { walkCommands, getRootProgram, getExtraHelp } from '../../core/help.ts';
import { stripAnsi } from '../../core/colors.ts';

type Format = 'markdown' | 'json' | 'text';

export interface CommandDoc {
  path: string;            // "fleex ticket list"
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  arguments: Array<{ name: string; description: string; required: boolean; variadic: boolean }>;
  options: Array<{ flags: string; description: string; defaultValue?: unknown; required: boolean; mandatory: boolean }>;
  subcommands: string[];   // names of direct children (excluding "help")
  /** ANSI-stripped `CommandDef.extraHelp` (Examples, notes) when the command declares one. */
  notes?: string;
}

const def: CommandDef = {
  name: 'documentation',
  aliases: ['docs'],
  description: 'Print the exhaustive CLI reference (every command, option, alias) — built for LLM discovery',
  setup(cmd) {
    cmd.option('-f, --format <format>', 'Output format: markdown | json | text', 'markdown');
  },
  action: async (opts: { format?: Format }) => {
    const format: Format = (opts.format ?? 'markdown');
    if (format !== 'markdown' && format !== 'json' && format !== 'text') {
      process.stderr.write(`fleex: unknown --format '${format}', expected markdown | json | text\n`);
      process.exit(2);
    }
    const root = getRootProgram();
    const docs = walkCommands(root)
      // Skip the implicit root itself — the doc reads better starting at level 1.
      .filter(({ cmd }) => cmd !== root)
      .map(({ cmd, path }) => describeCommand(cmd, path));

    if (format === 'json') {
      process.stdout.write(JSON.stringify({
        program: root.name(),
        version: root.version() ?? null,
        description: root.description() || null,
        commands: docs,
      }, null, 2) + '\n');
      return;
    }

    const renderer = format === 'markdown' ? renderMarkdown : renderText;
    process.stdout.write(renderer(root, docs));
  },
};

export default def;

/**
 * Curated goal → command recipes, rendered at the TOP of the reference so an
 * LLM maps an intent to the right command before scanning the full index.
 *
 * Why this static list lives in an otherwise zero-maintenance file: the whole
 * point is that some high-frequency agent tasks (esp. "attach a PR to a
 * ticket") were undiscoverable in the flat, alphabetical command dump. Keep it
 * SHORT, keep it in sync with the commands it points at, and centralise the
 * maintenance here in this single constant.
 */
const COMMON_TASKS: Array<{ goal: string; command: string }> = [
  { goal: 'Attacher / linker une PR GitHub existante à un ticket', command: 'fleex ticket link <ticket-id> --pr <pr-url|org/name#N>' },
  { goal: 'Attacher / linker une issue GitHub à un ticket', command: 'fleex ticket link <ticket-id> --issue <issue-url|org/name#N>' },
  { goal: 'Linker un repo à un ticket (crée le worktree)', command: 'fleex ticket link <ticket-id> --repo <org/name>' },
  { goal: 'Créer un ticket', command: 'fleex ticket create --title "…"' },
  { goal: 'Commenter un ticket', command: 'fleex ticket comment <ticket-id> "…"' },
  { goal: 'Déplacer un ticket vers un statut', command: 'fleex ticket move <ticket-id> <status>' },
  { goal: 'Trouver un ticket', command: 'fleex memory search "…"' },
  { goal: 'Lister les tickets actifs d\'un board', command: 'fleex ticket list --board <b> --status doing --limit 20 --json' },
  { goal: 'Créer ou remplacer un workflow (document JSON entier) — lire le contrat d\'abord', command: 'fleex workflow apply --documentation' },
];

/**
 * Token-budget rules for reading tickets, rendered right after Common tasks.
 * One oversized `ticket list --json` once returned >1M tokens and poisoned the
 * whole session (the result is re-sent every turn), so an agent must know the
 * defaults BEFORE its first call — hence a curated block at the top, not just
 * the per-command notes buried in the reference.
 */
const AGENT_RULES_HEADING = 'Rules for reading tickets (token budget)';
const AGENT_RULES: string[] = [
  '`fleex ticket list --json` is slim (grid columns + id, type, tags, updatedAt; never the description). `--json-full` loads every field and can blow the context window: use it deliberately, with `--limit`.',
  '`fleex ticket list` hides `done`/`cancelled` by default. Use `--status done` (comma-separated list accepted) or `--all` to see them.',
  '`fleex ticket list` returns 50 tickets at most by default, the most recently updated (`--limit 0` = all).',
  'Prefer `--board` + `--status` + `--limit`. For the full content of one ticket: `fleex ticket show <id>`. To *find* a ticket: `fleex memory search "<query>"` / `fleex memory similar "<title>"` rather than listing.',
];

export function describeCommand(cmd: Command, breadcrumb: string[]): CommandDoc {
  const args = (cmd as unknown as { registeredArguments?: Argument[]; _args?: Argument[] });
  const argList: Argument[] = (args.registeredArguments ?? args._args ?? []) as Argument[];
  const rawNotes = getExtraHelp(cmd);
  const notes = rawNotes ? stripAnsi(rawNotes).trim() : undefined;
  return {
    path: breadcrumb.join(' '),
    name: cmd.name(),
    aliases: cmd.aliases(),
    description: cmd.description() || '',
    usage: cmd.usage(),
    arguments: argList.map((a) => ({
      name: a.name(),
      description: a.description || '',
      required: (a as unknown as { required: boolean }).required ?? false,
      variadic: (a as unknown as { variadic: boolean }).variadic ?? false,
    })),
    options: cmd.options.map((o: Option) => ({
      flags: o.flags,
      description: o.description ?? '',
      defaultValue: o.defaultValue,
      required: o.required,
      mandatory: o.mandatory,
    })),
    subcommands: cmd.commands.filter((c) => c.name() !== 'help').map((c) => c.name()),
    ...(notes ? { notes } : {}),
  };
}

export function renderMarkdown(root: Command, docs: CommandDoc[]): string {
  const lines: string[] = [];
  lines.push(`# ${root.name()} CLI Reference`);
  if (root.version()) lines.push(`Version: \`${root.version()}\``);
  if (root.description()) lines.push('', root.description());
  lines.push('');
  lines.push('> Auto-generated from the live command tree. Re-run `fleex documentation` after any update.');
  lines.push('');
  lines.push('## Common tasks');
  lines.push('> Intention → commande. Si ton but est listé ici, utilise directement cette commande.');
  lines.push('');
  for (const t of COMMON_TASKS) lines.push(`- **${t.goal}** → \`${t.command}\``);
  lines.push('');
  lines.push(`## ${AGENT_RULES_HEADING}`);
  lines.push('');
  for (const r of AGENT_RULES) lines.push(`- ${r}`);
  lines.push('');
  lines.push('## Index');
  for (const d of docs) lines.push(`- \`${d.path}\` — ${d.description}`);
  lines.push('');

  for (const d of docs) {
    lines.push(`## \`${d.path}\``);
    if (d.aliases.length) lines.push(`**Aliases:** ${d.aliases.map((a) => `\`${a}\``).join(', ')}`);
    if (d.description) lines.push(d.description);
    lines.push('', '```');
    lines.push(`${d.path} ${d.usage}`.trim());
    lines.push('```');

    if (d.arguments.length) {
      lines.push('', '**Arguments:**', '');
      for (const a of d.arguments) {
        const tag = a.required ? `<${a.name}${a.variadic ? '...' : ''}>` : `[${a.name}${a.variadic ? '...' : ''}]`;
        lines.push(`- \`${tag}\` — ${a.description || '(no description)'}`);
      }
    }
    if (d.options.length) {
      lines.push('', '**Options:**', '');
      for (const o of d.options) {
        const dflt = o.defaultValue !== undefined && o.defaultValue !== false ? ` _(default: \`${JSON.stringify(o.defaultValue)}\`)_` : '';
        const req = o.mandatory ? ' **(required)**' : '';
        lines.push(`- \`${o.flags}\`${req} — ${o.description || '(no description)'}${dflt}`);
      }
    }
    if (d.notes) {
      lines.push('', '**Notes:**', '', '```', d.notes, '```');
    }
    if (d.subcommands.length) {
      lines.push('', `**Subcommands:** ${d.subcommands.map((s) => `\`${s}\``).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function renderText(root: Command, docs: CommandDoc[]): string {
  const lines: string[] = [];
  lines.push(`${root.name()} CLI Reference (v${root.version() ?? '?'})`);
  lines.push('');
  lines.push('Common tasks (intention -> command):');
  for (const t of COMMON_TASKS) lines.push(`  - ${t.goal} -> ${t.command}`);
  lines.push('');
  lines.push(`${AGENT_RULES_HEADING}:`);
  for (const r of AGENT_RULES) lines.push(`  - ${r.replace(/`/g, '')}`);
  lines.push('');
  for (const d of docs) {
    lines.push(`${d.path}${d.aliases.length ? ' (' + d.aliases.join(', ') + ')' : ''}`);
    lines.push(`  ${d.description}`);
    lines.push(`  usage: ${d.path} ${d.usage}`.trim());
    for (const a of d.arguments) {
      const tag = a.required ? `<${a.name}>` : `[${a.name}]`;
      lines.push(`  arg ${tag} — ${a.description || ''}`);
    }
    for (const o of d.options) {
      lines.push(`  opt ${o.flags}${o.mandatory ? ' (required)' : ''} — ${o.description || ''}`);
    }
    if (d.notes) {
      lines.push('  notes:');
      for (const ln of d.notes.split('\n')) lines.push(`    ${ln}`);
    }
    if (d.subcommands.length) lines.push(`  subcommands: ${d.subcommands.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
