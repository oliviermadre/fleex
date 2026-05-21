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
import { walkCommands, getRootProgram } from '../../core/help.ts';

type Format = 'markdown' | 'json' | 'text';

interface CommandDoc {
  path: string;            // "fleex ticket list"
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  arguments: Array<{ name: string; description: string; required: boolean; variadic: boolean }>;
  options: Array<{ flags: string; description: string; defaultValue?: unknown; required: boolean; mandatory: boolean }>;
  subcommands: string[];   // names of direct children (excluding "help")
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
      .map(({ cmd, path }) => describe(cmd, path));

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

function describe(cmd: Command, breadcrumb: string[]): CommandDoc {
  const args = (cmd as unknown as { registeredArguments?: Argument[]; _args?: Argument[] });
  const argList: Argument[] = (args.registeredArguments ?? args._args ?? []) as Argument[];
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
  };
}

function renderMarkdown(root: Command, docs: CommandDoc[]): string {
  const lines: string[] = [];
  lines.push(`# ${root.name()} CLI Reference`);
  if (root.version()) lines.push(`Version: \`${root.version()}\``);
  if (root.description()) lines.push('', root.description());
  lines.push('');
  lines.push('> Auto-generated from the live command tree. Re-run `fleex documentation` after any update.');
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
    if (d.subcommands.length) {
      lines.push('', `**Subcommands:** ${d.subcommands.map((s) => `\`${s}\``).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderText(root: Command, docs: CommandDoc[]): string {
  const lines: string[] = [];
  lines.push(`${root.name()} CLI Reference (v${root.version() ?? '?'})`);
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
    if (d.subcommands.length) lines.push(`  subcommands: ${d.subcommands.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
