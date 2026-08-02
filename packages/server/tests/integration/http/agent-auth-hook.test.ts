import { describe, it, expect, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedAgentToken, agentAuth } from '../../helpers/fixtures.js';

/**
 * `createAgentAuthHook` guards the `/api/agents/v1` scope only. The container
 * runs in `auth: 'none'` on purpose: the global middleware lets everything
 * through, so any 401 below can only come from the scope hook.
 */
describe('agent auth hook (/api/agents/v1)', () => {
  let h: TestAppHandle | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  const UNAUTHORIZED = {
    error: 'API_TOKEN_INVALID',
    message: 'Invalid or missing API token',
  };

  it('rejects a request with no Authorization header', async () => {
    h = await createTestApp({ auth: 'none' });
    const res = await h.app.inject({ method: 'GET', url: '/api/agents/v1/boards' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(UNAUTHORIZED);
  });

  it('rejects a non-Bearer scheme', async () => {
    h = await createTestApp({ auth: 'none' });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/agents/v1/boards',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(UNAUTHORIZED);
  });

  it('rejects an unknown token', async () => {
    h = await createTestApp({ auth: 'none' });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/agents/v1/boards',
      headers: { authorization: 'Bearer fleex_deadbeef' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(UNAUTHORIZED);
  });

  it('accepts a valid token', async () => {
    h = await createTestApp({ auth: 'none' });
    const { secret } = await seedAgentToken(h.container, { name: 'builder' });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/agents/v1/boards',
      headers: agentAuth(secret),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  /**
   * The identity the handlers see is `x-agent-name` when present, the token's
   * own name otherwise. `GET /settings` echoes `request.agent.name`, which
   * makes it the cheapest observation point for that decision.
   */
  it('lets x-agent-name override the token name', async () => {
    h = await createTestApp({ auth: 'none' });
    const { secret } = await seedAgentToken(h.container, { name: 'ci-token' });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/agents/v1/settings',
      headers: agentAuth(secret, 'builder'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'builder', status: 'active' });
  });

  it('falls back to the token name when x-agent-name is absent', async () => {
    h = await createTestApp({ auth: 'none' });
    const { secret } = await seedAgentToken(h.container, { name: 'ci-token' });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/agents/v1/settings',
      headers: agentAuth(secret),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'ci-token', status: 'active' });
  });

  it('does not leak outside the /api/agents/v1 scope', async () => {
    h = await createTestApp({ auth: 'none' });
    const res = await h.app.inject({ method: 'GET', url: '/api/boards' });
    expect(res.statusCode).toBe(200);
  });
});
