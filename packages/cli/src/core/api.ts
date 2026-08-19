import { die } from './colors.ts';
import { requirePorts } from './ports.ts';

export function apiBase(): string {
  const ports = requirePorts();
  return `http://localhost:${ports.server}`;
}

async function parseErrorMessage(res: Response): Promise<string> {
  let body: string;
  try {
    body = await res.text();
  } catch {
    return `(no body)`;
  }
  try {
    const j = JSON.parse(body);
    return j.message ?? j.error ?? body;
  } catch {
    return body;
  }
}

/**
 * How long to wait before giving up on the local server.
 *
 * Ten seconds suits a CRUD call. Anything that computes — a benchmark over the
 * whole index, or a command that spends a model call and may queue behind other
 * executions — has to raise it, or the CLI abandons work the server then finishes
 * alone and reports a failure that did not happen.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/** For a command that waits on a model call, possibly behind a concurrency queue. */
export const LLM_TIMEOUT_MS = 5 * 60_000;

/** For a benchmark: one embedding and one search per case, over hundreds of cases. */
export const BENCH_TIMEOUT_MS = 10 * 60_000;

async function request<T>(method: string, url: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let res: Response;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const opts: RequestInit = { method, signal: ctrl.signal };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    res = await fetch(url, opts);
  } catch {
    // Distinguished on purpose: a request that ran out of patience is a very
    // different problem from a server that is not there, and reporting both as a
    // connection error sends the reader looking for the wrong thing.
    if (ctrl.signal.aborted) {
      die(`API request timed out after ${Math.round(timeoutMs / 1000)}s: ${method} ${url}`);
    }
    die(`API request failed: ${method} ${url} (connection error)`);
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    const msg = await parseErrorMessage(res);
    die(`API error (HTTP ${res.status}): ${msg}`);
  }

  // No content
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * Like the api* helpers but throws on error instead of exiting the process.
 * Use when the caller wants to recover (e.g. continue a batch on failure).
 */
export async function apiCall<T = any>(method: string, url: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  opts.signal = ctrl.signal;
  let res: Response;
  try {
    res = await fetch(url, opts);
  } catch {
    if (ctrl.signal.aborted) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s: ${method} ${url}`);
    throw new Error(`connection error: ${method} ${url}`);
  } finally {
    clearTimeout(tid);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await parseErrorMessage(res)}`);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export function apiGet<T = any>(url: string, timeoutMs?: number): Promise<T> {
  return request<T>('GET', url, undefined, timeoutMs);
}
export function apiPost<T = any>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  return request<T>('POST', url, body, timeoutMs);
}
export function apiPut<T = any>(url: string, body: unknown): Promise<T> {
  return request<T>('PUT', url, body);
}
export function apiPatch<T = any>(url: string, body: unknown): Promise<T> {
  return request<T>('PATCH', url, body);
}
export function apiDelete(url: string): Promise<void> {
  return request<void>('DELETE', url);
}
