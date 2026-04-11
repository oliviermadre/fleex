import type { LoggerPort } from '../../../application/ports/logger.port.js';

interface QueryStats {
  count: number;
  totalMs: number;
  errors: number;
}

type OperationType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT' | 'RPC' | 'STORAGE' | 'AUTH' | 'UNKNOWN';

const STATS_INTERVAL_MS = 30_000;

type FetchHeaders = NonNullable<NonNullable<Parameters<typeof fetch>[1]>['headers']>;

function getPreferHeader(headers?: FetchHeaders): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get('Prefer') ?? undefined;
  if (Array.isArray(headers)) {
    const entry = (headers as [string, string][]).find(([k]) => k.toLowerCase() === 'prefer');
    return entry?.[1];
  }
  return (headers as Record<string, string>)['Prefer'] ?? (headers as Record<string, string>)['prefer'];
}

function parseRequest(
  url: string,
  method: string,
  headers?: FetchHeaders,
): { table: string; operation: OperationType } {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { table: 'unknown', operation: 'UNKNOWN' };
  }

  // PostgREST: /rest/v1/{table} or /rest/v1/rpc/{function}
  const restMatch = pathname.match(/\/rest\/v1\/(.+)/);
  if (restMatch && restMatch[1]) {
    const segment = restMatch[1];
    if (segment.startsWith('rpc/')) {
      return { table: segment, operation: 'RPC' };
    }

    let operation: OperationType;
    switch (method) {
      case 'GET':
      case 'HEAD':
        operation = 'SELECT';
        break;
      case 'POST': {
        const prefer = getPreferHeader(headers);
        operation = prefer?.includes('resolution=merge-duplicates') ? 'UPSERT' : 'INSERT';
        break;
      }
      case 'PATCH':
        operation = 'UPDATE';
        break;
      case 'DELETE':
        operation = 'DELETE';
        break;
      default:
        operation = 'UNKNOWN';
    }
    return { table: segment, operation };
  }

  // Storage: /storage/v1/...
  if (pathname.startsWith('/storage/')) {
    return { table: 'storage', operation: 'STORAGE' };
  }

  // Auth: /auth/v1/...
  if (pathname.startsWith('/auth/')) {
    return { table: 'auth', operation: 'AUTH' };
  }

  return { table: 'unknown', operation: 'UNKNOWN' };
}

function getCallerHint(): string {
  const stack = new Error().stack ?? '';
  const lines = stack.split('\n').slice(2);
  for (const line of lines) {
    if (line.includes('node_modules') || line.includes('node:')) continue;
    // Skip this file itself
    if (line.includes('supabase-query-logger')) continue;
    const match = line.match(/at\s+(.+)/);
    if (match?.[1]) return match[1].trim();
  }
  return 'unknown';
}

export function createInstrumentedFetch(
  logger: LoggerPort,
  _supabaseUrl: string,
): { fetch: typeof globalThis.fetch; dispose: () => void } {
  const stats = new Map<string, QueryStats>();
  let totalRequests = 0;

  const instrumentedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    const method = (
      init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
    ).toUpperCase();

    const { table, operation } = parseRequest(url, method, init?.headers ?? undefined);
    const key = `${table}:${operation}`;
    const callerHint = getCallerHint();

    const start = performance.now();
    try {
      const response = await globalThis.fetch(input, init);
      const durationMs = Math.round(performance.now() - start);

      const entry = stats.get(key) ?? { count: 0, totalMs: 0, errors: 0 };
      entry.count++;
      entry.totalMs += durationMs;
      totalRequests++;
      if (!response.ok) entry.errors++;
      stats.set(key, entry);

      logger.debug(`[supabase] ${operation} ${table}`, {
        method,
        table,
        operation,
        durationMs,
        status: response.status,
        caller: callerHint,
      });

      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const entry = stats.get(key) ?? { count: 0, totalMs: 0, errors: 0 };
      entry.count++;
      entry.totalMs += durationMs;
      entry.errors++;
      totalRequests++;
      stats.set(key, entry);

      logger.error(`[supabase] ${operation} ${table} FAILED`, {
        method,
        table,
        operation,
        durationMs,
        error: String(err),
        caller: callerHint,
      });
      throw err;
    }
  };

  const interval = setInterval(() => {
    if (stats.size === 0) return;

    const entries = [...stats.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([key, s]) => ({
        key,
        count: s.count,
        avgMs: Math.round(s.totalMs / s.count),
        errors: s.errors,
      }));

    logger.info(`[supabase] Query stats (last 30s): ${totalRequests} total requests`, {
      totalRequests,
      breakdown: entries,
    });

    stats.clear();
    totalRequests = 0;
  }, STATS_INTERVAL_MS);

  if (typeof interval === 'object' && 'unref' in interval) {
    interval.unref();
  }

  return {
    fetch: instrumentedFetch,
    dispose: () => clearInterval(interval),
  };
}
