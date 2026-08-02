/**
 * Cross-site request guard.
 *
 * Blocks state-changing requests initiated by a third-party page. We use
 * `Sec-Fetch-Site` rather than a CSRF token: it needs no server state, no
 * change to the web client / CLI / MCP / agents, and survives any proxy.
 *
 * Pure function, unit-tested rule by rule.
 */
import { isOriginAllowed } from './origin-policy.js';

export interface GuardInput {
  method: string;
  origin?: string | undefined;
  host?: string | undefined;
  /** The `Sec-Fetch-Site` request header. */
  secFetchSite?: string | undefined;
  isWebSocketUpgrade: boolean;
  hasBearerToken: boolean;
  allowlist: string[];
}

export type GuardResult = { allow: true } | { allow: false; reason: string };

const ALLOW: GuardResult = { allow: true };

export function evaluateRequest(input: GuardInput): GuardResult {
  const { method, origin, host, secFetchSite, isWebSocketUpgrade, hasBearerToken, allowlist } = input;

  // 1. Preflight — @fastify/cors owns the decision, and a preflight never
  //    reaches a handler.
  if (method === 'OPTIONS') return ALLOW;

  // 2. A WebSocket upgrade is a GET, so it would slip past rule 4. This is the
  //    rule that closes cross-site WebSocket hijacking on /ws and /ws/agents.
  if (isWebSocketUpgrade) {
    return isOriginAllowed({ origin, host, allowlist })
      ? ALLOW
      : { allow: false, reason: 'websocket upgrade from disallowed origin' };
  }

  // 3. Bearer auth is not ambient — a third-party page cannot mint one.
  if (hasBearerToken) return ALLOW;

  // 4. Safe methods. No GET/HEAD route on this server mutates state.
  if (method === 'GET' || method === 'HEAD') return ALLOW;

  // 5. The browser told us where the request came from. Trust it: the header is
  //    set by the user agent and cannot be forged from script.
  if (secFetchSite) {
    if (secFetchSite === 'cross-site') {
      return { allow: false, reason: 'cross-site mutation' };
    }
    return ALLOW;
  }

  // 6. No Sec-Fetch-Site but an Origin → older browser. Fall back to the origin
  //    policy.
  if (origin) {
    return isOriginAllowed({ origin, host, allowlist })
      ? ALLOW
      : { allow: false, reason: 'mutation from disallowed origin' };
  }

  // 7. Neither header → non-browser client (CLI, MCP, Claude Code hooks, agent
  //    SDK). No ambient credentials, so CSRF is impossible by construction.
  return ALLOW;
}

/** True when the request is an HTTP→WebSocket upgrade handshake. */
export function isWebSocketUpgrade(headers: {
  upgrade?: string | undefined;
  connection?: string | undefined;
}): boolean {
  return (headers.upgrade ?? '').toLowerCase() === 'websocket';
}

/** True when an `Authorization: Bearer …` header is present. */
export function hasBearerToken(authorization: string | undefined): boolean {
  return typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ');
}
