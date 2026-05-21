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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const opts: RequestInit = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    opts.signal = ctrl.signal;
    res = await fetch(url, opts);
    clearTimeout(tid);
  } catch {
    die(`API request failed: ${method} ${url} (connection error)`);
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

export function apiGet<T = any>(url: string): Promise<T> {
  return request<T>('GET', url);
}
export function apiPost<T = any>(url: string, body: unknown): Promise<T> {
  return request<T>('POST', url, body);
}
export function apiPatch<T = any>(url: string, body: unknown): Promise<T> {
  return request<T>('PATCH', url, body);
}
export function apiDelete(url: string): Promise<void> {
  return request<void>('DELETE', url);
}
