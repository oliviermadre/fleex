/**
 * End-to-end assembly test: helmet + cors + guard on a bare Fastify instance
 * with a stub route. Exercises the plugin exactly as main.ts registers it,
 * without booting the container.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSecurity } from '../../src/infrastructure/http/security.plugin.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

const logger: LoggerPort = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** Set on every call the guard lets through, so we can assert it was NOT run. */
let handlerRan = false;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerSecurity(app, logger);
  app.post('/probe', async () => {
    handlerRan = true;
    return { ok: true };
  });
  app.get('/probe', async () => ({ ok: true }));
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  handlerRan = false;
  vi.clearAllMocks();
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('CORS', () => {
  it('emits no Access-Control-Allow-Origin for a preflight from a foreign origin, so the browser never sends the real request', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/probe',
      headers: {
        origin: 'https://evil.com',
        host: 'localhost:3000',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reflects the Vite dev origin with credentials and Vary: Origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { origin: 'http://localhost:5173', host: 'localhost:3000' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(String(res.headers['vary'])).toContain('Origin');
  });

  it('allows the Tailscale origin when it matches the Host, and refuses the same origin when it does not', async () => {
    const matching = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { origin: 'https://mac.tail1234.ts.net', host: 'mac.tail1234.ts.net' },
    });
    expect(matching.headers['access-control-allow-origin']).toBe('https://mac.tail1234.ts.net');

    const mismatched = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { origin: 'https://mac.tail1234.ts.net', host: 'localhost:3000' },
    });
    expect(mismatched.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ignores X-Forwarded-Host: a forgeable header must not be able to satisfy the host-equality rule', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: {
        origin: 'https://evil.com',
        host: 'mac.tail1234.ts.net',
        'x-forwarded-host': 'evil.com',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('cross-site guard', () => {
  it('rejects a cross-site POST with 403 and never runs the handler — this is the RCE chain the ticket closes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { origin: 'https://evil.com', host: 'localhost:3000', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Cross-site request blocked' });
    expect(handlerRan).toBe(false);
  });

  it('lets a same-origin POST through', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
    });
    expect(res.statusCode).toBe(200);
    expect(handlerRan).toBe(true);
  });

  it('lets a headerless POST through, so the CLI, MCP and Claude Code hooks keep working', async () => {
    const res = await app.inject({ method: 'POST', url: '/probe' });
    expect(res.statusCode).toBe(200);
    expect(handlerRan).toBe(true);
  });

  it('lets a bearer-authenticated cross-site POST through: agent API clients are not subject to CSRF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: {
        authorization: 'Bearer tok_123',
        origin: 'https://evil.com',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(handlerRan).toBe(true);
  });

  it('lets a cross-site GET through: no read route mutates state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { origin: 'https://evil.com', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a WebSocket upgrade from a foreign origin, closing cross-site WebSocket hijacking of the PTY', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: {
        upgrade: 'websocket',
        connection: 'Upgrade',
        origin: 'https://evil.com',
        host: 'localhost:3000',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('logs a warning when it blocks, so refusals are observable rather than silent', async () => {
    await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { origin: 'https://evil.com', 'sec-fetch-site': 'cross-site' },
    });
    expect(logger.warn).toHaveBeenCalledWith('Cross-site request blocked', expect.objectContaining({
      method: 'POST',
      origin: 'https://evil.com',
    }));
  });
});

describe('response headers', () => {
  it('sets the hardening headers on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('ships a CSP that blocks framing, plugins and inline script, and — critically — omits upgrade-insecure-requests, which would rewrite every http://localhost call to https', async () => {
    const res = await app.inject({ method: 'GET', url: '/probe' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('derives the WebSocket connect-src from the request Host, so the Tailscale hostname needs no configuration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { host: 'mac.tail1234.ts.net' },
    });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain('wss://mac.tail1234.ts.net');
    expect(csp).toContain('ws://mac.tail1234.ts.net');
  });

  it('sends no HSTS by default: the nominal path is http://localhost and a stray HSTS pin would be sticky and painful', async () => {
    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('HSTS opt-in', () => {
  it('sends HSTS when FLEEX_ENABLE_HSTS=1', async () => {
    process.env['FLEEX_ENABLE_HSTS'] = '1';
    const hstsApp = await buildApp();
    try {
      const res = await hstsApp.inject({ method: 'GET', url: '/probe' });
      expect(res.headers['strict-transport-security']).toContain('max-age=15552000');
    } finally {
      await hstsApp.close();
      delete process.env['FLEEX_ENABLE_HSTS'];
    }
  });
});

describe('FLEEX_ALLOWED_ORIGINS', () => {
  it('reflects an operator-configured origin that matches neither Host nor loopback', async () => {
    process.env['FLEEX_ALLOWED_ORIGINS'] = 'https://fleex.example.com';
    const allowApp = await buildApp();
    try {
      const res = await allowApp.inject({
        method: 'GET',
        url: '/probe',
        headers: { origin: 'https://fleex.example.com', host: 'internal:3000' },
      });
      expect(res.headers['access-control-allow-origin']).toBe('https://fleex.example.com');
    } finally {
      await allowApp.close();
      delete process.env['FLEEX_ALLOWED_ORIGINS'];
    }
  });
});
