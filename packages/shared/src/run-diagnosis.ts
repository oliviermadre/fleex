/**
 * Why did an action fail? A pure reading of a finished run (exit code, output,
 * timeout/cancel flags) into one actionable hint — the same one the toast, the
 * logs, "Try" and "Test the probe" show.
 *
 * Background actions run in a *login, non-interactive* zsh without a TTY: no
 * `.zshrc`, so no aliases, functions or PATH it adds, and no `-it`. Most "works
 * in my terminal, not in Fleex" failures are one of those two, so they get a
 * dedicated explanation instead of a bare "exit 127".
 */

export type RunHintCode = 'not-found' | 'no-tty' | 'not-executable' | 'timeout' | 'cancelled';

export type RunHintSuggestion = 'run-in-terminal' | 'always-terminal' | 'diagnose-binary' | 'raise-timeout';

export interface RunHint {
  code: RunHintCode;
  /** Short — the toast title. */
  title: string;
  /** One or two sentences — the logs card. Empty when the title says it all. */
  detail: string;
  /** The program involved, for not-found / not-executable. */
  binary?: string;
  suggest: RunHintSuggestion[];
}

export type RunModeForDiagnosis = 'background' | 'terminal';

export interface DiagnosableRun {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  cancelled?: boolean;
  mode?: RunModeForDiagnosis;
  /** The command as run — used to name the binary when the output doesn't. */
  command?: string;
  /** For the timeout title. */
  timeoutSec?: number;
}

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'function',
  'time', 'sudo', 'env', 'exec', 'command', 'builtin', 'nohup', '!', '{', '}', '[', '[[', ']]', 'test',
  'echo', 'printf', 'true', 'false', 'cd', 'export', 'local', 'return', 'exit', 'read', 'set', 'unset', 'source', '.',
]);

/** A program name we can hand to `command -v` / `whence` without quoting. */
export const BINARY_NAME = /^[A-Za-z0-9_][\w.+-]*$/;

/**
 * Program names a shell command would run, in order: the first word of each
 * `&&` / `||` / `;` / `|` segment, skipping `VAR=value`, wrappers (sudo, env…)
 * and shell keywords. Quoted text is ignored so `echo "a | b"` stays one segment.
 */
export function extractBinaries(command: string): string[] {
  const found: string[] = [];
  const withoutQuotes = command
    .replace(/'[^']*'/g, "''")
    // Keep `"$(cmd)"` readable (cmd is a program); `"$HOME"` is just text.
    .replace(/"(?:[^"\\$]|\\.|\$(?!\())*"/g, '""');
  const segments = withoutQuotes.split(/&&|\|\||[;|\n]|\$\(|`|\bthen\b|\bdo\b|\belse\b/);
  for (const segment of segments) {
    const words = segment.trim().replace(/^[({\s!]+/, '').split(/\s+/);
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || ['sudo', 'env', 'nohup', 'time', 'exec', 'command'].includes(words[i]!))) i += 1;
    const word = words[i];
    if (!word) continue;
    const name = word.replace(/[)}"']+$/, '');
    if (!BINARY_NAME.test(name)) continue;
    if (SHELL_KEYWORDS.has(name)) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

const NOT_FOUND = [/command not found: ([^\s:]+)/i, /zsh: ([^\s:]+): command not found/i, /(?:^|\n)([^\s:]+): command not found/i];
const NO_TTY = /not a tty|input device is not a tty|stdin is not a terminal|inappropriate ioctl for device|must be run from a terminal/i;
const PERMISSION_DENIED = [/permission denied: ([^\s:]+)/i, /(?:^|\n)([^\s:]+): permission denied/i];

function binaryFrom(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = p.exec(text);
    const name = m?.slice(1).find(Boolean);
    if (name) return name.split('/').pop();
  }
  return undefined;
}

export function diagnoseRun(run: DiagnosableRun): RunHint | null {
  const terminal = run.mode === 'terminal';
  const text = `${run.stderr ?? ''}\n${run.stdout ?? ''}`;
  const firstBinary = run.command ? extractBinaries(run.command)[0] : undefined;

  if (run.cancelled) return { code: 'cancelled', title: 'Stopped', detail: '', suggest: [] };

  if (run.timedOut) {
    return {
      code: 'timeout',
      title: run.timeoutSec ? `Timed out after ${run.timeoutSec} s` : 'Timed out',
      detail: terminal
        ? 'The command did not finish in time.'
        : 'The command did not finish in time. Raise the timeout, or run it in a terminal if it is waiting for you.',
      suggest: terminal ? ['raise-timeout'] : ['raise-timeout', 'run-in-terminal'],
    };
  }

  // A clean exit is never a failure, whatever the output says.
  if (run.exitCode === 0 || run.exitCode === undefined) return null;

  const notFoundBinary = binaryFrom(text, NOT_FOUND);
  if (run.exitCode === 127 || notFoundBinary) {
    const binary = notFoundBinary ?? firstBinary;
    return {
      code: 'not-found',
      title: binary ? `Command not found: ${binary}` : 'Command not found',
      detail: terminal
        ? 'It is not installed, or not on the PATH of your shell.'
        : 'Actions run in a login, non-interactive zsh: .zshrc is not loaded, so neither its aliases, its functions nor the PATH it adds. Put the command in a script on your PATH (e.g. ~/.local/bin), or run the action in a terminal.',
      ...(binary ? { binary } : {}),
      suggest: terminal ? ['diagnose-binary'] : ['diagnose-binary', 'run-in-terminal'],
    };
  }

  if (!terminal && NO_TTY.test(text)) {
    return {
      code: 'no-tty',
      title: 'This command needs a terminal',
      detail: 'It asks for a TTY (e.g. docker run -it, a prompt), which a background action does not have.',
      suggest: ['run-in-terminal', 'always-terminal'],
    };
  }

  const deniedBinary = binaryFrom(text, PERMISSION_DENIED);
  if (run.exitCode === 126 || (deniedBinary && deniedBinary === firstBinary)) {
    const binary = deniedBinary ?? firstBinary;
    return {
      code: 'not-executable',
      title: binary ? `${binary} is not executable` : 'Not executable',
      detail: `The file exists but is not allowed to run: chmod +x ${binary ? `<path to ${binary}>` : '<path>'}.`,
      ...(binary ? { binary } : {}),
      suggest: ['diagnose-binary'],
    };
  }

  return null;
}

// ─── Binary diagnosis: what an action sees vs what your terminal sees ───

export type BinaryKind = 'command' | 'alias' | 'function' | 'builtin' | 'missing';

export interface BinaryDiagnosis {
  binary: string;
  /** Seen by a background action (zsh -l -c, no .zshrc). */
  login: 'command' | 'builtin' | 'missing';
  /** Seen by your terminal (zsh -i, .zshrc loaded). */
  interactive: BinaryKind;
  path?: string;
  /** The alias body, when `interactive === 'alias'` (≤ 500 chars). */
  aliasDefinition?: string;
  /** The alias asks for a TTY (`-it`, `-t`, `--tty`). */
  usesTty?: boolean;
}

/** `-it`, `-ti`, `-t` or `--tty` as a standalone flag. */
const TTY_FLAG = /(?:^|\s)(?:-[a-zA-Z]*t[a-zA-Z]*|--tty)(?=\s|$)/;

export function aliasUsesTty(definition: string): boolean {
  return TTY_FLAG.test(definition);
}

/**
 * A script equivalent to an alias, to drop in ~/.local/bin: same command, the
 * arguments passed through, and `-t` only when a real terminal is attached so
 * it works both from your shell and from a background action. Fleex only ever
 * puts this on the clipboard — it never writes into the user's home.
 */
export function scriptFromAlias(binary: string, definition: string): string {
  let body = definition.trim();
  const tty = aliasUsesTty(body);
  if (tty) {
    body = body
      .replace(/(^|\s)--tty(?=\s|$)/g, '$1$tty')
      .replace(/(^|\s)-([a-zA-Z]*)t([a-zA-Z]*)(?=\s|$)/g, (_m, pre: string, a: string, b: string) => {
        const rest = `${a}${b}`;
        return `${pre}${rest ? `-${rest} ` : ''}$tty`;
      });
  }
  return [
    '#!/bin/sh',
    `# ~/.local/bin/${binary} — then: chmod +x ~/.local/bin/${binary}`,
    `# Replaces the "${binary}" alias of your .zshrc (remove the alias line there).`,
    ...(tty ? ['tty=""; [ -t 0 ] && tty="-t"   # -t only inside a real terminal'] : []),
    `exec ${body} "$@"`,
    '',
  ].join('\n');
}
