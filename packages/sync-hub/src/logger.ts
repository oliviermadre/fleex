/** Verbosity: 0 = quiet (default), 1 = -v (connections + relay), 2 = -vv (all) */
let verbosity = 0;

const args = process.argv.slice(2);
if (args.includes('-vv')) {
  verbosity = 2;
} else if (args.includes('-v')) {
  verbosity = 1;
}

export function logInfo(...args: unknown[]): void {
  if (verbosity >= 1) console.log(...args);
}

export function logDebug(...args: unknown[]): void {
  if (verbosity >= 2) console.log(...args);
}

export function logAlways(...args: unknown[]): void {
  console.log(...args);
}

export function logError(...args: unknown[]): void {
  console.error(...args);
}

export function getVerbosity(): number {
  return verbosity;
}
