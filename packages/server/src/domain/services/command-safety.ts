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
  /\brm\b[^|;&]*\s--recursive\b/,
  /\bgit\s+branch\b[^|;&]*\s-D\b/,
  /\bgit\s+push\b[^|;&]*\s(?:--delete\b|-d\b|\+|:[^\s/]+)/, // push --delete, push origin :branch, push origin +ref
  /\bdelete\s+from\b/i,
  /\btruncate\b/i,
  /\bfind\b[^|;&]*\s-delete\b/,
  /\baws\s+s3\s+(?:rm|rb)\b/,
  /\bgh\s+repo\s+delete\b/,
  />\s*(?:~|\$HOME|\$\{HOME\})\/\./, // overwrite a home dotfile (~/.zshrc, ~/.ssh/…)
  /\bkubectl\b[^|;&]*\bdrain\b/,
  /\bkubectl\b[^|;&]*\bscale\b[^|;&]*--replicas[=\s]+0\b/,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(command));
}

/** The stricter of the model's label and the server's own floor. */
export function enforceRisk(command: string, modelRisk: CommandRisk | undefined): CommandRisk {
  if (isDestructiveCommand(command)) return 'destructive';
  return modelRisk === 'destructive' || modelRisk === 'mutating' || modelRisk === 'safe' ? modelRisk : 'mutating';
}

/**
 * The executables a shell command depends on — shared with the web (the editor
 * warns about .zshrc aliases) and the run diagnosis, so all three agree.
 */
export { extractBinaries } from '@fleex/shared';
