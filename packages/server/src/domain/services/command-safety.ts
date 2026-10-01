import type { CommandRisk } from '@fleex/shared';

/**
 * Patterns that make a command destructive whatever the model claims.
 *
 * The model's risk label is advice; this list is the floor. These commands touch
 * prod and staging clusters, so a suggestion that would delete, force-push or
 * wipe something is always shown in red, even if the model calls it "safe".
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+)*-[a-zA-Z]*[rf]/, // rm -rf, rm -fr, rm -r
  /\bprune\b/,
  /\bkubectl\b[^|;&]*\bdelete\b/,
  /\bdrop\s+(?:table|database|schema)\b/i,
  /--force\b/,
  /\bgit\s+push\b[^|;&]*\s-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  />\s*\/(?!dev\/null)/, // redirect onto an absolute path
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bhelm\s+(?:uninstall|delete)\b/,
  /\bterraform\s+destroy\b/,
  /\bgcloud\b[^|;&]*\bdelete\b/,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(command));
}

/** The stricter of the model's label and the server's own floor. */
export function enforceRisk(command: string, modelRisk: CommandRisk | undefined): CommandRisk {
  if (isDestructiveCommand(command)) return 'destructive';
  return modelRisk === 'destructive' || modelRisk === 'mutating' || modelRisk === 'safe' ? modelRisk : 'mutating';
}

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'function',
  'time', 'sudo', 'env', 'exec', 'command', 'builtin', 'nohup', '!', '{', '}', '[', '[[', ']]', 'test',
  'echo', 'printf', 'true', 'false', 'cd', 'export', 'local', 'return', 'exit', 'read', 'set', 'unset', 'source', '.',
]);

/**
 * The executables a shell command depends on: the first word of each pipeline
 * segment (`&&`, `||`, `;`, `|`, newlines, `$(…)`), minus shell keywords,
 * builtins and variable assignments. Used to tell the user "gh not found" before
 * they save an action that can never work on this machine.
 */
export function extractBinaries(command: string): string[] {
  const found: string[] = [];
  const withoutQuotes = command
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\$]|\\.)*"/g, '""');
  const segments = withoutQuotes.split(/&&|\|\||[;|\n]|\$\(|`|\bthen\b|\bdo\b|\belse\b/);
  for (const segment of segments) {
    const words = segment.trim().replace(/^[({\s!]+/, '').split(/\s+/);
    let i = 0;
    // Skip `VAR=value` prefixes and wrapper words like sudo/env.
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || ['sudo', 'env', 'nohup', 'time', 'exec', 'command'].includes(words[i]!))) i += 1;
    const word = words[i];
    if (!word) continue;
    const name = word.replace(/[)}"']+$/, '');
    if (!/^[A-Za-z0-9_][\w.+-]*$/.test(name)) continue;
    if (SHELL_KEYWORDS.has(name)) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}
