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
 * Visible (printable) length of a string ignoring ANSI escape sequences.
 * Used for manual column padding because chalk-wrapped strings break %-Ns
 * printf padding.
 */
export function visibleLength(s: string): number {
  // strip ANSI escape sequences. Equivalent to strip-ansi for SGR sequences.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '').length;
}

export function padEndVisible(s: string, width: number): string {
  const len = visibleLength(s);
  if (len >= width) return s;
  return s + ' '.repeat(width - len);
}
