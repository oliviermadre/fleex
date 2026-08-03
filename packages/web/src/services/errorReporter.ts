import {
  CLIENT_ERROR_MAX_COMPONENT_STACK,
  CLIENT_ERROR_MAX_MESSAGE,
  CLIENT_ERROR_MAX_PER_PAGE,
  CLIENT_ERROR_MAX_STACK,
  type ClientErrorReport,
  type ClientErrorSource,
} from '@fleex/shared';

import { API_URL } from '../lib/constants';

/**
 * Ships client crashes to `POST /api/client-errors`, which logs them through
 * the same pino pipeline as the server's own errors.
 *
 * Three rules govern everything here, because this module runs *while the app
 * is already broken*:
 *
 *  1. **It never throws.** A throw inside `componentDidCatch` re-enters the
 *     boundary and can escalate a dead view into a dead app.
 *  2. **It never uses `api.ts`.** `request()` raises a toast on failure; a
 *     failing report would then raise a toast, which could fail, which… The
 *     reporter talks to `fetch` directly and swallows the result on purpose.
 *  3. **It is capped.** A render loop can call this hundreds of times per
 *     second. Dedup + a hard per-page ceiling keep a broken client from
 *     turning into a DoS against the server.
 */

export interface ClientErrorInput {
  readonly error: unknown;
  readonly source: ClientErrorSource;
  readonly boundary?: string;
  readonly viewKey?: string;
  readonly componentStack?: string;
  /** Pre-generated so the crash screen can display the same id it reports. */
  readonly errorId?: string;
}

/** Reports sent during this page load. Reset only by a real page reload. */
let sentCount = 0;

/** Fingerprints already reported, so a render loop reports once, not N times. */
const seenFingerprints = new Set<string>();

let handlersInstalled = false;

/** `err_` + 8 hex. Short enough to read aloud, unique enough for a log grep. */
export function generateErrorId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `err_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** Normalise the many shapes a thrown value can take (`throw 'boom'` is legal). */
function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

/**
 * Identity of a crash for dedup purposes. The stack prefix distinguishes two
 * different bugs that happen to share a message; capping it at 200 chars keeps
 * the *same* bug from looking new when a deep frame differs.
 */
function fingerprint(
  message: string,
  stack: string | undefined,
  boundary: string | undefined,
): string {
  return `${message}::${(stack ?? '').slice(0, 200)}::${boundary ?? ''}`;
}

/** POST without awaiting. `sendBeacon` survives a page that is going away. */
function send(report: ClientErrorReport): void {
  const url = `${API_URL}/client-errors`;
  const body = JSON.stringify(report);

  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden' &&
    typeof navigator.sendBeacon === 'function'
  ) {
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    return;
  }

  // Fire-and-forget. This is the one place in the codebase where an empty
  // catch is correct: there is no recovery from "failed to report a failure",
  // and surfacing it would create the feedback loop described above.
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

/**
 * Report a client error. Always returns the id used, so a caller (the error
 * boundary) can display the very same id it sent.
 *
 * Silently no-ops when the page cap is reached or the crash was already
 * reported — by design, the caller must not care.
 */
export function reportClientError(input: ClientErrorInput): string {
  const errorId = input.errorId ?? generateErrorId();
  try {
    if (sentCount >= CLIENT_ERROR_MAX_PER_PAGE) return errorId;

    const { message, stack } = describeError(input.error);
    const fp = fingerprint(message, stack, input.boundary);
    if (seenFingerprints.has(fp)) return errorId;
    seenFingerprints.add(fp);

    sentCount += 1;

    send({
      errorId,
      message: truncate(message, CLIENT_ERROR_MAX_MESSAGE) ?? '',
      stack: truncate(stack, CLIENT_ERROR_MAX_STACK),
      componentStack: truncate(input.componentStack, CLIENT_ERROR_MAX_COMPONENT_STACK),
      source: input.source,
      boundary: input.boundary,
      viewKey: input.viewKey,
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      occurredAt: new Date().toISOString(),
      seq: sentCount,
    });
  } catch {
    // Reporting must never make things worse — see rule 1 above.
  }
  return errorId;
}

/**
 * Catch errors React boundaries structurally cannot see: event handlers,
 * `setTimeout` callbacks, and rejected promises.
 *
 * Idempotent — safe under React StrictMode's double-invocation.
 */
export function installGlobalErrorHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    reportClientError({
      error: event.error ?? event.message,
      source: 'window.onerror',
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportClientError({
      error: event.reason,
      source: 'unhandledrejection',
    });
  });
}

/** Test-only: clear the per-page cap and dedup set. */
export function __resetErrorReporterForTests(): void {
  sentCount = 0;
  seenFingerprints.clear();
  handlersInstalled = false;
}
