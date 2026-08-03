import { describe, it, expect } from 'vitest';

import {
  evaluateRequest,
  hasBearerToken,
  isWebSocketUpgrade,
  type GuardInput,
} from '../../src/infrastructure/http/request-guard.js';

function req(partial: Partial<GuardInput> = {}): GuardInput {
  return {
    method: 'POST',
    host: 'localhost:3000',
    isWebSocketUpgrade: false,
    hasBearerToken: false,
    allowlist: [],
    ...partial,
  };
}

describe('rule 1 — preflight', () => {
  it('lets OPTIONS through even from a cross-site origin: @fastify/cors owns that decision and a preflight never reaches a handler', () => {
    expect(
      evaluateRequest(
        req({ method: 'OPTIONS', origin: 'https://evil.com', secFetchSite: 'cross-site' }),
      ),
    ).toEqual({ allow: true });
  });
});

describe('rule 2 — WebSocket upgrade', () => {
  it('blocks an upgrade from a foreign origin: this is the rule that closes cross-site WebSocket hijacking of the PTY on /ws', () => {
    const r = evaluateRequest(
      req({ method: 'GET', origin: 'https://evil.com', isWebSocketUpgrade: true }),
    );
    expect(r.allow).toBe(false);
  });

  it('allows an upgrade whose Origin matches the Host, so the mobile Tailscale WS keeps working', () => {
    expect(
      evaluateRequest(
        req({
          method: 'GET',
          origin: 'https://mac.tail1234.ts.net',
          host: 'mac.tail1234.ts.net',
          isWebSocketUpgrade: true,
        }),
      ),
    ).toEqual({ allow: true });
  });

  it('allows an upgrade with no Origin — a non-browser WS client', () => {
    expect(
      evaluateRequest(req({ method: 'GET', origin: undefined, isWebSocketUpgrade: true })),
    ).toEqual({ allow: true });
  });

  it('is checked BEFORE the safe-method rule, otherwise the upgrade GET would slip past the guard entirely', () => {
    // Same input as the blocked case above but stated as the regression it guards:
    // if rule 2 ever moved below rule 4, this would return allow.
    const r = evaluateRequest(
      req({
        method: 'GET',
        origin: 'https://evil.com',
        isWebSocketUpgrade: true,
        secFetchSite: 'cross-site',
      }),
    );
    expect(r).toEqual({ allow: false, reason: 'websocket upgrade from disallowed origin' });
  });
});

describe('rule 3 — bearer token', () => {
  it('allows a cross-site mutation carrying a bearer token: it is not ambient credentials, so a third-party page cannot mint one', () => {
    expect(
      evaluateRequest(
        req({
          method: 'POST',
          origin: 'https://evil.com',
          secFetchSite: 'cross-site',
          hasBearerToken: true,
        }),
      ),
    ).toEqual({ allow: true });
  });
});

describe('rule 4 — safe methods', () => {
  it.each(['GET', 'HEAD'])(
    'allows a cross-site %s: no read route on this server mutates state',
    (method) => {
      expect(evaluateRequest(req({ method, secFetchSite: 'cross-site' }))).toEqual({ allow: true });
    },
  );
});

describe('rule 5 — Sec-Fetch-Site', () => {
  it('blocks a cross-site mutation — the whole point of the ticket', () => {
    expect(evaluateRequest(req({ method: 'POST', secFetchSite: 'cross-site' }))).toEqual({
      allow: false,
      reason: 'cross-site mutation',
    });
  });

  it.each(['same-origin', 'same-site', 'none'])('allows %s', (secFetchSite) => {
    expect(evaluateRequest(req({ method: 'POST', secFetchSite }))).toEqual({ allow: true });
  });

  it('allows same-site, because localhost:5173 → localhost:3000 in dev is same-site and must keep working', () => {
    expect(
      evaluateRequest(
        req({ method: 'POST', origin: 'http://localhost:5173', secFetchSite: 'same-site' }),
      ),
    ).toEqual({ allow: true });
  });

  it('trusts Sec-Fetch-Site over the Origin header: the browser sets it and script cannot forge it', () => {
    // Origin would pass the loopback rule, but the browser says cross-site.
    expect(
      evaluateRequest(
        req({ method: 'POST', origin: 'http://localhost:5173', secFetchSite: 'cross-site' }),
      ).allow,
    ).toBe(false);
  });
});

describe('rule 6 — no Sec-Fetch-Site but an Origin (older browsers)', () => {
  it('falls back to the origin policy and blocks a foreign origin', () => {
    expect(evaluateRequest(req({ method: 'POST', origin: 'https://evil.com' }))).toEqual({
      allow: false,
      reason: 'mutation from disallowed origin',
    });
  });

  it('allows an origin matching the Host', () => {
    expect(
      evaluateRequest(
        req({ method: 'POST', origin: 'https://mac.tail1234.ts.net', host: 'mac.tail1234.ts.net' }),
      ),
    ).toEqual({ allow: true });
  });
});

describe('rule 7 — neither header', () => {
  it('allows a mutation with no Origin and no Sec-Fetch-Site: that is the CLI, MCP, a Claude Code hook or an agent, none of which carry ambient credentials', () => {
    expect(evaluateRequest(req({ method: 'POST' }))).toEqual({ allow: true });
  });
});

describe('isWebSocketUpgrade', () => {
  it('detects the handshake case-insensitively, since header casing is not guaranteed', () => {
    expect(isWebSocketUpgrade({ upgrade: 'WebSocket', connection: 'Upgrade' })).toBe(true);
    expect(isWebSocketUpgrade({ upgrade: 'websocket' })).toBe(true);
  });

  it('is false for a plain request', () => {
    expect(isWebSocketUpgrade({})).toBe(false);
  });
});

describe('hasBearerToken', () => {
  it('accepts any casing of the scheme', () => {
    expect(hasBearerToken('Bearer abc')).toBe(true);
    expect(hasBearerToken('bearer abc')).toBe(true);
  });

  it('rejects other schemes and absence', () => {
    expect(hasBearerToken('Basic abc')).toBe(false);
    expect(hasBearerToken(undefined)).toBe(false);
  });
});
