import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  clientErrorRoutes,
  __resetClientErrorRateLimit,
} from '../../src/infrastructure/http/client-errors.routes.js';
import { FakeLoggerPort } from '../helpers/fakes.js';
import type { Container } from '../../src/infrastructure/container.js';

/**
 * The ingress for browser crashes. Its job is to make a client-side crash show
 * up in the server log pipeline — and to be impossible to weaponise, since it
 * is deliberately unauthenticated (a crash must be reportable when the session
 * is already dead).
 */

const VALID_REPORT = {
  errorId: 'err_1a2b3c4d',
  message: 'analytics exploded',
  source: 'boundary',
  url: 'http://localhost:5173/analytics',
  occurredAt: '2026-08-02T10:00:00.000Z',
  userAgent: 'vitest',
  boundary: 'main-view',
  viewKey: 'analytics',
  seq: 1,
};

async function buildApp(logger: FakeLoggerPort): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(clientErrorRoutes({ logger } as unknown as Container));
  return app;
}

describe('POST /api/client-errors', () => {
  let logger: FakeLoggerPort;
  let app: FastifyInstance;

  beforeEach(async () => {
    __resetClientErrorRateLimit();
    logger = new FakeLoggerPort();
    app = await buildApp(logger);
  });

  it('routes a browser crash into the server log pipeline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: VALID_REPORT,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });

    const logged = logger.logs.find((l) => l.msg === 'client error');
    expect(logged?.level).toBe('error');
    // The fields that make a report actionable: which boundary, which view.
    expect(logged?.data).toMatchObject({
      errorId: 'err_1a2b3c4d',
      message: 'analytics exploded',
      boundary: 'main-view',
      viewKey: 'analytics',
      source: 'boundary',
    });
  });

  // The client truncates too, but the client is exactly what just crashed.
  it('truncates oversized fields rather than trusting the client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: {
        ...VALID_REPORT,
        message: 'x'.repeat(2_000),
        stack: 'y'.repeat(20_000),
        componentStack: 'z'.repeat(10_000),
      },
    });

    expect(res.statusCode).toBe(202);
    const data = logger.logs.find((l) => l.msg === 'client error')!.data!;
    expect((data.message as string).length).toBe(500);
    expect((data.stack as string).length).toBe(8_000);
    expect((data.componentStack as string).length).toBe(4_000);
  });

  // A render loop can fire reports as fast as React re-renders. Unbounded, an
  // unauthenticated endpoint is a log-flooding DoS.
  it('stops accepting past 30 reports a minute from one IP', async () => {
    for (let i = 0; i < 30; i++) {
      const ok = await app.inject({ method: 'POST', url: '/api/client-errors', payload: VALID_REPORT });
      expect(ok.json()).toEqual({ accepted: true });
    }

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: VALID_REPORT,
    });

    // Still 202: the client has no reason to retry a dropped crash report.
    expect(rejected.statusCode).toBe(202);
    expect(rejected.json()).toEqual({ accepted: false });
    expect(logger.logs.filter((l) => l.msg === 'client error')).toHaveLength(30);
  });

  it('warns once per window, not once per rejection — the log flood is the attack', async () => {
    for (let i = 0; i < 40; i++) {
      await app.inject({ method: 'POST', url: '/api/client-errors', payload: VALID_REPORT });
    }

    expect(logger.logs.filter((l) => l.level === 'warn')).toHaveLength(1);
  });

  it('refuses a payload missing the fields that make a report identifiable', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: { message: 'no id, no source, no url' },
    });

    expect(res.statusCode).toBe(400);
    expect(logger.logs.filter((l) => l.msg === 'client error')).toHaveLength(0);
  });

  it('answers 202 even when logging itself blows up', async () => {
    const brokenLogger = new FakeLoggerPort();
    brokenLogger.error = () => {
      throw new Error('log sink down');
    };
    const brokenApp = await buildApp(brokenLogger);

    const res = await brokenApp.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: VALID_REPORT,
    });

    // A 500 from the error-reporting endpoint would be absurd.
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: false });
  });
});
