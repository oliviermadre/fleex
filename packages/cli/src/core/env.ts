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

/**
 * Load a .env file into process.env. Existing env vars are NOT overridden.
 */
export function loadDotEnv(filePath: string): void {
  const vars = parseDotEnv(filePath);
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
