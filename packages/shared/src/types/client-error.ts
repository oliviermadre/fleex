/**
 * Client-side crash reports shipped to `POST /api/client-errors`.
 *
 * Shared web ↔ server so the Fastify body schema and the browser reporter
 * can never drift apart.
 */

/** Where the error was intercepted. Drives triage: a `boundary` error killed a
 *  view, an `unhandledrejection` is usually a failed background promise. */
export type ClientErrorSource =
  'boundary' | 'window.onerror' | 'unhandledrejection' | 'react.uncaught';

/**
 * Size caps. Enforced on BOTH sides: the client truncates to keep requests
 * small, the server re-truncates because a client can lie.
 */
export const CLIENT_ERROR_MAX_MESSAGE = 500;
export const CLIENT_ERROR_MAX_STACK = 8_000;
export const CLIENT_ERROR_MAX_COMPONENT_STACK = 4_000;

/** Max reports a single page load may send. Stops a crash loop from flooding. */
export const CLIENT_ERROR_MAX_PER_PAGE = 10;

export interface ClientErrorReport {
  /** `err_` + 8 hex. Printed on the crash screen so a user report can be
   *  matched to the server log line. */
  readonly errorId: string;
  readonly message: string;
  readonly stack?: string;
  /** React's component stack — only present when `source === 'boundary'`. */
  readonly componentStack?: string;
  readonly source: ClientErrorSource;
  /** Name of the boundary that caught it (`root`, `main-view`, …). */
  readonly boundary?: string;
  /** Identity of the view being rendered, from `useMainViewKey()`. */
  readonly viewKey?: string;
  readonly url: string;
  readonly userAgent: string;
  /** ISO 8601. */
  readonly occurredAt: string;
  /** 1-based position within this page load; reveals crash loops in the logs. */
  readonly seq: number;
}

export interface ClientErrorResponse {
  /** `false` when rate-limited. The client never retries either way. */
  readonly accepted: boolean;
}
