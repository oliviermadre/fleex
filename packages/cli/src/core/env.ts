import fs from 'node:fs';

/**
 * Parse a .env file and return its key-value pairs.
 * Handles optional single/double quoting of values. Skips blank lines and
 * lines that don't match the KEY=value pattern.
 */
export function parseDotEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      let val = m[2] ?? '';
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[m[1]!] = val;
    }
  }
  return vars;
}

export interface ApplyEnvOptions {
  /** When true, overwrite variables already present in process.env. Default false. */
  override?: boolean;
}

/**
 * Merge a set of variables into process.env.
 *
 * By default existing variables are preserved (non-override), matching .env
 * semantics. Pass `{ override: true }` to force the supplied values to win —
 * used when activating a workspace, whose config must beat both the shell and
 * the repo .env.
 */
export function applyEnv(vars: Record<string, string>, opts: ApplyEnvOptions = {}): void {
  const override = opts.override ?? false;
  for (const [k, v] of Object.entries(vars)) {
    if (override || process.env[k] === undefined) process.env[k] = v;
  }
}

/**
 * Load a .env file into process.env. Existing env vars are NOT overridden.
 */
export function loadDotEnv(filePath: string): void {
  applyEnv(parseDotEnv(filePath), { override: false });
}
