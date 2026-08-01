/**
 * Scoped, leveled front-end logger (#371, from #362).
 *
 * `packages/server` has a leveled logger (LoggerPort + Pino); `packages/web`
 * had raw `console.*` — unfilterable, unstructured, unrecoverable. This module
 * is the front equivalent, with the same `(msg, data?)` API as LoggerPort so
 * the muscle memory carries across packages.
 *
 * Fleex is self-hosted with no Sentry and no telemetry, so production is NOT
 * silent: the console defaults to `warn` (dev: `debug`). Turn it down with
 * `?log=silent`, up with `?log=debug` — no rebuild. Independently of that
 * level, every call lands in a bounded ring buffer readable via
 * `window.__fleexLog.dump()`, which is what makes a `debug()` call worth
 * writing even though prod will not print it.
 *
 * Usage — scope is the module path relative to src/, without extension:
 *   const log = createLogger('stores/skillStore');
 *   log.error('Failed to load skills', { err });
 *
 * Enforced by scripts/check-no-console.mjs (wired into `bun run lint`): this
 * file is the only place in packages/web/src allowed to call console.*.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogData = Record<string, unknown>;

export interface Logger {
  debug(msg: string, data?: LogData): void;
  info(msg: string, data?: LogData): void;
  warn(msg: string, data?: LogData): void;
  error(msg: string, data?: LogData): void;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  data?: LogData;
}

export interface FleexLogHandle {
  /** Copy of the ring buffer, oldest first. */
  entries(): LogEntry[];
  /** Pretty JSON of the buffer — paste into a bug report. */
  dump(): string;
  getLevel(): LogLevel;
  setLevel(level: LogLevel): void;
}

declare global {
  interface Window {
    __fleexLog?: FleexLogHandle;
  }
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const STORAGE_KEY = 'fleex:logLevel';
const QUERY_PARAM = 'log';
const BUFFER_CAPACITY = 200;

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in RANK;
}

/** `?log=<level>` — for the mobile PWA, where setting localStorage means opening devtools. */
function readQueryParam(): LogLevel | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(QUERY_PARAM);
  return isLogLevel(value) ? value : null;
}

function readStorage(): LogLevel | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLogLevel(value) ? value : null;
  } catch {
    return null; // Safari private mode, disabled storage
  }
}

function persist(level: LogLevel): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Best effort: the level still applies for this session.
  }
}

/** Query param (persisted) > localStorage > build default. Invalid values fall through. */
function resolveLevel(): LogLevel {
  const fromQuery = readQueryParam();
  if (fromQuery) {
    persist(fromQuery); // survive the navigation that strips the param
    return fromQuery;
  }
  return readStorage() ?? (import.meta.env.DEV ? 'debug' : 'warn');
}

let currentLevel: LogLevel = resolveLevel();

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  persist(level);
}

const buffer: LogEntry[] = [];

/** Shallow: Error values become serializable. Deep traversal is not needed by any call site. */
function normalizeData(data: LogData): LogData {
  const out: LogData = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] =
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value;
  }
  return out;
}

function writeToConsole(level: LogLevel, line: string, data: LogData | undefined): void {
  // console.* is resolved at call time, not captured at module init, so devtools
  // overrides (and test spies) still see the call.
  switch (level) {
    case 'debug':
      data ? console.debug(line, data) : console.debug(line);
      break;
    case 'info':
      data ? console.info(line, data) : console.info(line);
      break;
    case 'warn':
      data ? console.warn(line, data) : console.warn(line);
      break;
    case 'error':
      data ? console.error(line, data) : console.error(line);
      break;
    case 'silent':
      break;
  }
}

function emit(level: LogLevel, scope: string, msg: string, data?: LogData): void {
  if (currentLevel === 'silent') return; // silent means silent — buffer included

  const normalized = data ? normalizeData(data) : undefined;

  buffer.push({
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(normalized ? { data: normalized } : {}),
  });
  if (buffer.length > BUFFER_CAPACITY) buffer.shift();

  // The buffer captures everything; only the console is gated by the level.
  if (RANK[level] < RANK[currentLevel]) return;

  writeToConsole(level, `[fleex:${scope}] ${msg}`, normalized);
}

/**
 * @param scope module path relative to src/, without extension.
 *   e.g. `'stores/agentEventStore'`, `'components/tickets/KanbanCard'`
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (msg, data) => emit('debug', scope, msg, data),
    info: (msg, data) => emit('info', scope, msg, data),
    warn: (msg, data) => emit('warn', scope, msg, data),
    error: (msg, data) => emit('error', scope, msg, data),
  };
}

if (typeof window !== 'undefined') {
  const entries = (): LogEntry[] => buffer.map((entry) => ({ ...entry }));
  window.__fleexLog = {
    entries,
    dump: () => JSON.stringify(entries(), null, 2),
    getLevel: getLogLevel,
    setLevel: setLogLevel,
  };
}
