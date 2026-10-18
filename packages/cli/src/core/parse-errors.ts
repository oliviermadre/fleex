/**
 * How a leaf command reports a parsing error (unknown option, missing argument…).
 *
 * `fleex memory ask --question "…"` used to look like a silent `exit 1`: the
 * one useful line came first, then the full help (~16 lines) buried it, and a
 * caller that only keeps the tail of stderr (an agent's tool output, `tail`)
 * saw nothing but generic help. Even read, `unknown option '--question'` did not
 * say what to do.
 *
 * The mistake is predictable: the MCP layer exposes every positional argument
 * as a named field (`question`, `subject`, `agent`), so an agent going back to
 * the shell naturally writes `--question`. The CLI knows the argument's name and
 * the value passed, so it can hand back the exact command to run instead.
 *
 * Group commands (`fleex memory`) are left alone: their errors keep the help,
 * which is the list of subcommands the reader is looking for.
 */
import { Command } from 'commander';

const UNKNOWN_OPTION = /^error: unknown option '([^']+)'/;

/** Comparison key: `--Question`, `--question_text`, `--question-text` all match. */
const normalise = (name: string): string => name.toLowerCase().replace(/[-_]/g, '');

/** Shell-safe double-quoted value. */
const quote = (value: string): string => `"${value.replace(/(["\\$`])/g, '\\$1')}"`;

/** Leave plain tokens (`--repo`, `o/r`, `20`) as typed, quote the rest. */
const shellToken = (token: string): string => (/^[\w@%+=:,./-]+$/.test(token) ? token : quote(token));

/** The leaf's own tokens: what follows its command path in the raw argv. */
function tokensAfterPath(cmd: Command, rawArgs: readonly string[]): string[] {
  const chain: Command[] = [];
  for (let c: Command | null = cmd; c?.parent; c = c.parent) chain.unshift(c);
  let i = 0;
  for (const c of chain) {
    const names = [c.name(), ...c.aliases()];
    while (i < rawArgs.length && !names.includes(rawArgs[i]!)) i++;
    i++;
  }
  return rawArgs.slice(Math.min(i, rawArgs.length));
}

/** `--repo`, `--foo=x`, `-r`, `-h`: a token that reads as a flag rather than a value like `-1 bug`. */
function isOption(cmd: Command, token: string): boolean {
  if (!token.startsWith('-')) return false;
  const flag = token.split('=')[0];
  if (/^--[a-z]/i.test(token)) return true; // a long flag, known or not, is never the value
  return flag === '-h' || flag === '--' || cmd.options.some((o) => o.short === flag);
}

/** `fleex memory ask` — the canonical path, without aliases. */
function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

/**
 * `error: --question is not an option…` + `Try: …`, when the unknown flag is
 * really the name of one of the command's positional arguments. `null` otherwise.
 */
export function positionalHint(flag: string, cmd: Command, rawArgs: readonly string[]): string | null {
  if (!flag.startsWith('--')) return null;
  const eq = flag.indexOf('=');
  const name = flag.slice(2, eq === -1 ? undefined : eq);
  const argument = cmd.registeredArguments.find((a) => normalise(a.name()) === normalise(name));
  if (!argument) return null;

  const tokens = tokensAfterPath(cmd, rawArgs);
  const at = tokens.indexOf(flag);
  let value: string | null = null;
  let consumed = 1;
  if (eq !== -1) {
    value = flag.slice(eq + 1);
  } else if (at !== -1 && tokens[at + 1] !== undefined && !isOption(cmd, tokens[at + 1]!)) {
    value = tokens[at + 1]!;
    consumed = 2;
  }
  const rest = (at === -1 ? tokens : [...tokens.slice(0, at), ...tokens.slice(at + consumed)]).map(shellToken);
  const path = commandPath(cmd);
  // A value like `-1 bug` would be read back as an option: it goes after `--`.
  const tryLine = value === null ? [path, `"<${argument.name()}>"`, ...rest].join(' ')
    : value.startsWith('-') ? [path, ...rest, '--', quote(value)].join(' ')
    : [path, quote(value), ...rest].join(' ');

  return `error: --${name} is not an option — <${argument.name()}> is a positional argument.\n`
    + `  Try: ${tryLine}`;
}

/**
 * The whole error block, at most five lines: the error (or the positional
 * hint), the usage line, and where to find the full help.
 */
export function formatParseError(message: string, cmd: Command, rawArgs: readonly string[]): string {
  const flag = UNKNOWN_OPTION.exec(message)?.[1];
  const head = (flag && positionalHint(flag, cmd, rawArgs)) || message.trimEnd();
  const usage = cmd.createHelp().commandUsage(cmd);
  return `${head}\n\nUsage: ${usage}\nRun \`${commandPath(cmd)} --help\` for all options.`;
}

/** The root of the tree; commander records the parsed argv there. */
function rootOf(cmd: Command): Command {
  let c = cmd;
  while (c.parent) c = c.parent;
  return c;
}

/**
 * `Command` whose leaves report parsing errors in the short form above.
 *
 * Subclassing (with `createCommand`) is commander's supported way to change a
 * command's behaviour. `configureOutput` would not do: every command shares the
 * same output configuration object, so it cannot differ between a leaf and the
 * group above it.
 */
export class FleexCommand extends Command {
  override createCommand(name?: string): Command {
    return new FleexCommand(name);
  }

  override error(message: string, errorOptions?: { code?: string; exitCode?: number }): never {
    if (this.commands.length > 0) return super.error(message, errorOptions);
    // The leaf's own short block replaces the full help it inherited from the root.
    this.showHelpAfterError(false);
    // `rawArgs` is set by commander on the command that ran `parse()`; it is not public API.
    const rawArgs = (rootOf(this) as unknown as { rawArgs?: string[] }).rawArgs ?? process.argv;
    return super.error(formatParseError(message, this, rawArgs), errorOptions);
  }
}
