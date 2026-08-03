import { describe, it, expect, afterEach, vi } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedAgentToken } from '../../helpers/fixtures.js';

/**
 * `createAuthMiddleware` reads the OAuth env vars ONCE, when it is constructed.
 * Every `vi.stubEnv` here therefore has to happen before `createTestApp()`.
 */
function enableOAuth(): void {
  vi.stubEnv('GITHUB_CLIENT_ID', 'client-id');
  vi.stubEnv('GITHUB_CLIENT_SECRET', 'client-secret');
}

describe('auth middleware', () => {
  let h: TestAppHandle | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
    vi.unstubAllEnvs();
  });

  describe('mode 1 — no database', () => {
    it('lets an anonymous request through as the default user', async () => {
      h = await createTestApp({ auth: 'none' });
      const res = await h.app.inject({ method: 'GET', url: '/api/boards' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('mode 2 — database, no OAuth provider', () => {
    it('lets an anonymous request through', async () => {
      h = await createTestApp({ auth: 'db-no-oauth' });
      const res = await h.app.inject({ method: 'GET', url: '/api/boards' });
      expect(res.statusCode).toBe(200);
    });

    it('accepts a valid Bearer token and records its use', async () => {
      h = await createTestApp({ auth: 'db-no-oauth' });
      const { entity, secret } = await seedAgentToken(h.container, { name: 'ci' });
      expect(entity.lastUsedAt).toBeNull();

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/boards',
        headers: { authorization: `Bearer ${secret}` },
      });

      expect(res.statusCode).toBe(200);
      const stored = await h.container.agentTokenStore.getByHash(entity.hashedSecret);
      expect(stored?.lastUsedAt).not.toBeNull();
    });

    it('rejects an unknown Bearer token with 401', async () => {
      h = await createTestApp({ auth: 'db-no-oauth' });
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/boards',
        headers: { authorization: 'Bearer fleex_nope' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Invalid token' });
    });
  });

  describe('mode 3 — database + OAuth', () => {
    it('rejects a request with no cookie', async () => {
      enableOAuth();
      h = await createTestApp({ auth: 'full' });
      const res = await h.app.inject({ method: 'GET', url: '/api/boards' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Authentication required' });
    });

    it('rejects an unknown session cookie', async () => {
      enableOAuth();
      h = await createTestApp({ auth: 'full' });
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/boards',
        headers: { cookie: 'fleex_session=nope' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Session expired' });
    });

    it('accepts a valid session cookie', async () => {
      enableOAuth();
      h = await createTestApp({ auth: 'full' });
      const sessionId = await h.sessionManager!.create('user-42');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/boards',
        headers: { cookie: `fleex_session=${sessionId}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('exempt prefixes (still enforced under full auth)', () => {
    it('lets /auth/* through', async () => {
      enableOAuth();
      h = await createTestApp({ auth: 'full' });
      const res = await h.app.inject({ method: 'GET', url: '/auth/status' });
      expect(res.statusCode).toBe(200);
    });

    it('lets /health through', async () => {
      enableOAuth();
      h = await createTestApp({ auth: 'full' });
      const res = await h.app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });

    it('lets /internal/* through — 404 (no such route), never 401', async () => {
      enableOAuth();
      h = await createTestApp({ auth: 'full' });
      const res = await h.app.inject({ method: 'GET', url: '/internal/whatever' });
      expect(res.statusCode).toBe(404);
    });
  });

  /**
   * `POST /api/hook` is the Claude Code hook ingress: a local `curl` with no
   * cookie and no Bearer token. It used to be missing from the middleware's
   * exempt prefix list, so under full SSO it answered 401 and every hook event
   * was silently dropped — a failure invisible from the UI, where the cockpit
   * simply stops updating.
   *
   * Registering `hookRoutes` before `app.addHook('preHandler', authMiddleware)`
   * does NOT exempt it: Fastify's `addHook` recurses into `kChildren` and
   * back-fills contexts already registered. Registration order is irrelevant;
   * the prefix allow-list inside `createAuthMiddleware` is the only thing that
   * exempts anything — which is why the fix had to be the allow-list.
   *
   * Skipping session auth does not leave the route open: it enforces
   * localhost-only remotes and a 30s anti-replay window itself — see
   * hook.routes.test.ts.
   */
  it('accepts POST /api/hook under full auth — the ingress carries no cookie', async () => {
    enableOAuth();
    h = await createTestApp({ auth: 'full' });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/hook',
      payload: { event: 'sessionStart', cwd: '/tmp/project', timestamp: Date.now() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true });
  });

  /** The exemption is a prefix skip, so it must not widen into an API hole. */
  it('still requires auth on other /api routes under full auth', async () => {
    enableOAuth();
    h = await createTestApp({ auth: 'full' });

    const res = await h.app.inject({ method: 'GET', url: '/api/boards' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Authentication required' });
  });

  it('accepts POST /api/hook when SSO is off (modes 1 and 2)', async () => {
    h = await createTestApp({ auth: 'none' });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/hook',
      payload: { event: 'sessionStart', cwd: '/tmp/project', timestamp: Date.now() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true });
  });
});
