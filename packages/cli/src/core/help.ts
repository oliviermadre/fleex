/**
 * Pretty help formatter for the fleex CLI.
 *
 * Goals:
 * - Match the look of the old bash CLI (yellow section titles, green command
 *   names, cyan flags, neat 2-column layout).
 * - Stay 100% driven by Commander's metadata so newly added commands inherit
 *   the styling automatically (no per-command formatting).
 * - Let individual commands append rich sections (Aliases, Examples, valid
 *   values, ...) via `CommandDef.extraHelp` — see types.ts.
 *
 * Implementation note: we override Commander's `formatHelp` instead of relying
 * on v12's per-term style hooks (commander 12 doesn't expose them yet).
 */
import chalk from 'chalk';

import { visibleLength } from './colors.ts';

import type { Command, Help, Option } from 'commander';

const SECTION = chalk.bold.yellow;
const CMD_NAME = chalk.green;
const FLAG = chalk.cyan;
const ARG = chalk.magenta;
const PROGRAM = chalk.bold;
const DIM = chalk.dim;

const INDENT = '  ';
const GAP = 2; // spaces between term column and description column

let rootProgram: Command | null = null;

export function setRootProgram(p: Command): void {
  rootProgram = p;
}

export function getRootProgram(): Command {
  if (!rootProgram) throw new Error('Root program not initialised');
  return rootProgram;
}

// ── extraHelp capture ────────────────────────────────────────────────────────
// `CommandDef.extraHelp` is rendered through Commander's `addHelpText`, which
// offers no way to read the text back. `fleex documentation` must expose it
// (as a `notes` field) so LLM agents discovering the CLI see the Examples and
// Notes too — the bootstrap registers the resolved text here at attach time.
const extraHelpByCommand = new WeakMap<Command, string>();

export function recordExtraHelp(cmd: Command, text: string): void {
  extraHelpByCommand.set(cmd, text);
}

export function getExtraHelp(cmd: Command): string | undefined {
  return extraHelpByCommand.get(cmd);
}

/**
 * Recursively configure every command in the tree to use the pretty help
 * formatter. Safe to call multiple times.
 */
export function applyPrettyHelp(root: Command): void {
  applyToCommand(root);
}

function applyToCommand(cmd: Command): void {
  cmd.configureHelp({
    formatHelp: (c, h) => formatHelp(c, h),
    showGlobalOptions: false,
    sortSubcommands: false,
    sortOptions: false,
  });
  // Customise the `--help` flag wording to align with the rest.
  cmd.helpOption('-h, --help', 'Show this help');
  for (const sub of cmd.commands) {
    applyToCommand(sub);
  }
}

/**
 * Build the full help string for a command.
 */
function formatHelp(cmd: Command, helper: Help): string {
  const lines: string[] = [];

  // 1) Header: "fleex ticket — Manage tickets from the CLI"
  const fullName = fullCommandName(cmd);
  const desc = cmd.description() || '';
  lines.push('');
  lines.push(`${PROGRAM(fullName)}${desc ? '  ' + DIM('—') + ' ' + desc : ''}`);
  lines.push('');

  // 2) Usage
  const usage = helper.commandUsage(cmd);
  lines.push(SECTION('Usage:'));
  lines.push(`${INDENT}${colourUsage(usage)}`);
  lines.push('');

  // 3) Arguments (positional)
  const args = helper.visibleArguments(cmd);
  if (args.length > 0) {
    lines.push(SECTION('Arguments:'));
    const rows: Array<[string, string]> = args.map((a) => [
      ARG(helper.argumentTerm(a)),
      helper.argumentDescription(a) || '',
    ]);
    appendTwoColumn(lines, rows);
    lines.push('');
  }

  // 4) Subcommands
  const subs = helper.visibleCommands(cmd).filter((s) => s.name() !== 'help');
  if (subs.length > 0) {
    lines.push(SECTION('Commands:'));
    const rows: Array<[string, string]> = subs.map((s) => [
      colourSubcommandTerm(s),
      s.description() || '',
    ]);
    appendTwoColumn(lines, rows);
    lines.push('');

    // Inline aliases summary (e.g. "ls=list, new=create, ...")
    const aliasParts: string[] = [];
    for (const s of subs) {
      const a = s.aliases();
      for (const al of a) aliasParts.push(`${CMD_NAME(al)}=${CMD_NAME(s.name())}`);
    }
    if (aliasParts.length > 0) {
      lines.push(SECTION('Aliases:'));
      lines.push(`${INDENT}${aliasParts.join(', ')}`);
      lines.push('');
    }
  }

  // 5) Options
  const opts = helper.visibleOptions(cmd);
  if (opts.length > 0) {
    lines.push(SECTION('Options:'));
    const rows: Array<[string, string]> = opts.map((o) => [
      colourOptionTerm(o, helper),
      helper.optionDescription(o) || '',
    ]);
    appendTwoColumn(lines, rows);
    lines.push('');
  }

  return lines.join('\n');
}

function fullCommandName(cmd: Command): string {
  const chain: string[] = [];
  let cur: Command | null = cmd;
  while (cur) {
    chain.unshift(cur.name());
    cur = cur.parent as Command | null;
  }
  return chain.join(' ');
}

function colourSubcommandTerm(sub: Command): string {
  // Build "name <arg> [opts]" with the name in green and any usage args
  // surfaced from the subcommand's own usage line.
  const name = CMD_NAME(sub.name());
  // Strip "name" prefix from usage to get the args portion only.
  const usage = sub.usage();
  return usage ? `${name} ${DIM(usage)}` : name;
}

function colourOptionTerm(opt: Option, helper: Help): string {
  const term = helper.optionTerm(opt);
  // Split "-h, --help <foo>" → colour flags cyan, argument placeholder magenta.
  return term
    .replace(/(--?[\w-]+)/g, (m) => FLAG(m))
    .replace(/(<[^>]+>|\[[^\]]+\])/g, (m) => ARG(m));
}

function colourUsage(usage: string): string {
  return usage
    .replace(/\[command\]/g, DIM('[command]'))
    .replace(/\[options\]/g, DIM('[options]'))
    .replace(/(<[^>]+>|\[[^\]]+\])/g, (m) => ARG(m));
}

/**
 * Render rows as a two-column block, padded so the second column lines up.
 * Uses visibleLength so ANSI codes don't break alignment.
 */
function appendTwoColumn(lines: string[], rows: [string, string][]): void {
  const widest = rows.reduce((m, [term]) => Math.max(m, visibleLength(term)), 0);
  for (const [term, desc] of rows) {
    const pad = ' '.repeat(widest - visibleLength(term) + GAP);
    if (!desc) {
      lines.push(`${INDENT}${term}`);
    } else {
      lines.push(`${INDENT}${term}${pad}${desc}`);
    }
  }
}

/**
 * Walks the command tree starting at `root` (default = program) and yields
 * each leaf command together with its full breadcrumb. Useful for the
 * documentation generator.
 */
export function walkCommands(root?: Command): Array<{ cmd: Command; path: string[] }> {
  const start = root ?? getRootProgram();
  const out: Array<{ cmd: Command; path: string[] }> = [];
  const walk = (cmd: Command, path: string[]): void => {
    const here = [...path, cmd.name()];
    out.push({ cmd, path: here });
    for (const sub of cmd.commands) {
      if (sub.name() === 'help') continue;
      walk(sub, here);
    }
  };
  walk(start, []);
  return out;
}
