import chalk from 'chalk';

export const c = {
  red: chalk.red,
  green: chalk.green,
  yellow: chalk.yellow,
  blue: chalk.blue,
  cyan: chalk.cyan,
  bold: chalk.bold,
  dim: chalk.dim,
};

const tag = chalk.blue('[fleex]');

// ── Machine-readable output mode ──
// Toggled by the global `--json` flag (see src/core/program.ts). When on,
// data-returning commands emit a single JSON line instead of formatted text,
// and errors are emitted as `{ "ok": false, "error": "..." }` on stdout — so
// programmatic consumers (the MCP tool layer) get structured results.
let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * In JSON mode, print `data` as a single JSON line. Otherwise run `renderHuman`
 * (the existing formatted output). Lets a command serve both audiences without
 * duplicating its fetch logic.
 */
export function present(data: unknown, renderHuman: () => void): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data) + '\n');
    return;
  }
  renderHuman();
}

export function info(msg: string): void {
  process.stdout.write(`${tag} ${msg}\n`);
}

export function ok(msg: string): void {
  process.stdout.write(`${chalk.green('[fleex]')} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stdout.write(`${chalk.yellow('[fleex]')} ${msg}\n`);
}

export function err(msg: string): void {
  process.stderr.write(`${chalk.red('[fleex]')} ${msg}\n`);
}

export function die(msg: string): never {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    process.exit(1);
  }
  err(msg);
  process.exit(1);
}

/**
 * ANSI color code for a ticket status. Returns an identity-fn fallback so
 * callers can always call `statusColor(status)(text)`.
 */
export function statusColor(status: string): (s: string) => string {
  switch (status) {
    case 'done':
      return chalk.green;
    case 'doing':
      return chalk.yellow;
    case 'reviewing':
      return chalk.cyan;
    case 'todo':
      return chalk.blue;
    case 'cancelled':
      return chalk.red;
    case 'backlog':
      return chalk.dim;
    default:
      return (s) => s;
  }
}

/**
 * Strip ANSI SGR escape sequences from a string. Equivalent to strip-ansi
 * for SGR sequences. Used for column padding and for the plain-text `notes`
 * export in `fleex documentation`.
 */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Visible (printable) length of a string ignoring ANSI escape sequences.
 * Used for manual column padding because chalk-wrapped strings break %-Ns
 * printf padding.
 */
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

export function padEndVisible(s: string, width: number): string {
  const len = visibleLength(s);
  if (len >= width) return s;
  return s + ' '.repeat(width - len);
}
