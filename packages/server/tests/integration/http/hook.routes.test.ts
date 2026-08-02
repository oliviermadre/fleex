import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { SessionEntity } from '../../../src/domain/entities.js';
import type { Container } from '../../../src/infrastructure/container.js';

/**
 * `POST /api/hook` is the Claude Code hook ingress: a local `curl` fired by
 * `fleex hook <event>` from `~/.claude/settings.json`. Its contract is unusual
 * and worth pinning precisely:
 *
 *   - it is localhost-only, enforced in the handler (not by the auth middleware);
 *   - it has an anti-replay window of ±30 s;
 *   - it MUST NEVER fail Claude's hook, so a use-case explosion still answers
 *     200 with `{ accepted: false, reason: 'error' }`.
 *
 * Everything below asserts the status code first, because a silent status
 * change here means hook events are dropped without anybody noticing: the CLI
 * discards the response.
 *
 * NOT covered here (locked in auth-middleware.test.ts instead): under full SSO
 * this route answers 401 — a known bug with its own ticket.
 */

/** Mirrors `MAX_AGE_MS` in hook.routes.ts. */
const MAX_AGE_MS = 30_000;

interface HookBody {
  event?: unknown;
  cwd?: unknown;
  timestamp?: unknown;
  payload?: Record<string, unknown>;
}

/** A nominal, in-window body. `inject()` defaults `remoteAddress` to 127.0.0.1. */
function hookBody(over: HookBody = {}): Record<string, unknown> {
  return {
    event: 'sessionStart',
    cwd: '/tmp/fleex-hook-project',
    timestamp: Date.now(),
    ...over,
  };
}

describe('POST /api/hook', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  describe('nominal', () => {
    it('accepts a fresh event from the default (localhost) remote address', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/api/hook', payload: hookBody() });

      expect(res.statusCode).toBe(200);
      // `sessionStart` maps to no status change — observability only — so the
      // use case reports `observedOnly` while the route still says accepted.
      expect(res.json()).toMatchObject({ accepted: true, matched: false, observedOnly: true });
    });

    it('applies the mapped status to a session whose cwd matches, and reports it', async () => {
      const cwd = '/tmp/fleex-hook-project';
      const session = new SessionEntity(
        randomUUID(), 'fleex_hook_test', 'claude', 'running', cwd,
        new Date(), null, null, null, null, null,
      );
      await h.container.sessionStore.save(session);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        // `userPromptSubmit` → hookStatus 'working'.
        payload: hookBody({ event: 'userPromptSubmit', cwd }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: true, matched: true, sessionsTouched: 1 });
      const stored = await h.container.sessionStore.getById(session.id);
      expect(stored?.hookStatus).toBe('working');
    });

    it.each([
      ['IPv6 loopback', '::1'],
      ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1'],
      ['IPv4 loopback', '127.0.0.1'],
    ])('accepts a %s remote (%s)', async (_label, remoteAddress) => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        remoteAddress,
        payload: hookBody(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: true });
    });
  });

  describe('anti-replay window (±30 s, NOT 60 s)', () => {
    it('rejects an event older than 30 s as stale — still 200', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: hookBody({ timestamp: Date.now() - (MAX_AGE_MS + 1_000) }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: false, reason: 'stale' });
    });

    it('rejects an event more than 30 s in the future as future — still 200', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: hookBody({ timestamp: Date.now() + (MAX_AGE_MS + 1_000) }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: false, reason: 'future' });
    });

    it('still accepts an event just inside the window (29 s old)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: hookBody({ timestamp: Date.now() - 29_000 }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: true });
    });

    it('still accepts an event 29 s in the future (tolerated clock skew)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: hookBody({ timestamp: Date.now() + 29_000 }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: true });
    });
  });

  describe('localhost-only', () => {
    it('answers 403 for a non-local remote address', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        remoteAddress: '10.0.0.1',
        payload: hookBody(),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden' });
    });

    /**
     * The check is a `Set.has` on the exact string, so anything that merely
     * *looks* loopback (127.0.0.2, the whole 127/8 block) is refused. Locked so
     * that widening `LOCAL_REMOTES` is a deliberate change.
     */
    it('answers 403 for 127.0.0.2 — the allow-list is exact strings, not a subnet', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        remoteAddress: '127.0.0.2',
        payload: hookBody(),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden' });
    });

    it('rejects a non-local remote before looking at the timestamp', async () => {
      // A stale body from a remote host must still get 403, not 200/'stale':
      // the security check runs first and must stay first.
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        remoteAddress: '10.0.0.1',
        payload: hookBody({ timestamp: 0 }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden' });
    });
  });

  /**
   * ⚠️  KNOWN BUG, LOCKED ON PURPOSE.
   *
   * The route declares a JSON body schema (`required: ['event','cwd',
   * 'timestamp']`, an `event` enum of 7 values, `cwd` `minLength: 1`,
   * `additionalProperties: false`). Fastify raises a `FastifyError` carrying
   * `statusCode: 400` and `code: 'FST_ERR_VALIDATION'` when it fails.
   *
   * But `registerErrorHandler` (error-handler.ts) overwrites the status: it
   * only special-cases `DomainError`, and every other error — validation
   * included — is answered as
   *   500 { error: 'INTERNAL_ERROR', message: 'body must ...' }.
   *
   * So a malformed hook body answers 500, not 400. This is wrong for every
   * route in the app, not just this one; the design spec for this ticket
   * expected 400 here. The fix (honour `error.statusCode` / `FST_ERR_VALIDATION`
   * in the error handler) is its own ticket. Locked as-is so the fix shows up
   * as a reviewed red→green diff instead of hiding in a refactor.
   */
  describe('body schema validation (rejections answer 500, should be 400 — see comment)', () => {
    it('rejects an `event` outside the 7-value enum', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: hookBody({ event: 'not-a-hook-event' }),
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
      expect(res.json().message).toContain('event');
    });

    it('rejects a body with no `cwd`', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: { event: 'stop', timestamp: Date.now() },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().message).toContain('cwd');
    });

    it('rejects an empty `cwd` (minLength 1)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: hookBody({ cwd: '' }),
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().message).toContain('cwd');
    });

    it('rejects a body with no `timestamp`', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: { event: 'stop', cwd: '/tmp/x' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().message).toContain('timestamp');
    });

    /**
     * Surprise worth pinning: `additionalProperties: false` does NOT reject
     * here. Fastify's default AJV instance runs with `removeAdditional: true`,
     * so an unknown top-level property is silently stripped and the request
     * succeeds. Anyone reading the schema would predict a 4xx; the wire says
     * 200. Locked so that flipping the AJV options is a visible change.
     */
    it('silently strips an unknown top-level property instead of rejecting it', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/hook',
        payload: { ...hookBody(), rogue: 'nope' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: true });
    });

    it('accepts every one of the 7 enum values', async () => {
      for (const event of [
        'sessionStart', 'sessionEnd', 'userPromptSubmit',
        'notification', 'stop', 'stopFailure', 'preToolUse',
      ]) {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/hook',
          payload: hookBody({ event }),
        });
        expect(res.statusCode, `event=${event}`).toBe(200);
        expect(res.json(), `event=${event}`).toMatchObject({ accepted: true });
      }
    });
  });

  /**
   * The whole point of the route's try/catch: Claude Code treats a non-2xx hook
   * response as a hook failure and surfaces it to the user. A Fleex-side crash
   * must therefore be invisible. Triggered honestly, by making the real use
   * case throw through the container — the route code path is untouched.
   */
  it('answers 200 { accepted: false, reason: "error" } when the use case throws', async () => {
    await h.close();
    h = await createTestApp({
      overrides: {
        processHookEvent: {
          execute: async () => {
            throw new Error('boom from processHookEvent');
          },
        } as unknown as Container['processHookEvent'],
      },
    });

    const res = await h.app.inject({ method: 'POST', url: '/api/hook', payload: hookBody() });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: false, reason: 'error' });
  });
});
