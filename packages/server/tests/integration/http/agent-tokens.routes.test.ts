import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentToken, AgentTokenCreated } from '@fleex/shared';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedAgentToken } from '../../helpers/fixtures.js';
import { ApiTokenEntity } from '../../../src/domain/entities/api-token.entity.js';

/**
 * `/api/agent-tokens` mints the bearer credentials that `/api/agents/v1/*`
 * accepts. Two properties matter more than anything else here, and both are
 * asserted as SECURITY properties rather than incidental shape checks:
 *
 *   1. The raw secret is returned EXACTLY ONCE, by `POST`. Only a SHA-256 hash
 *      is stored, so a secret lost after that response is unrecoverable.
 *   2. `GET` must never leak it. The store only holds `hashedSecret`, but a
 *      future `toDTO()` that spreads the entity would silently expose it — so
 *      the absence is asserted on the RAW response text, not just on parsed
 *      keys. A nested or renamed leak still fails the test.
 */

describe('agent token routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  describe('GET /api/agent-tokens', () => {
    it('answers 200 with an empty list on a fresh install', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/agent-tokens' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and lists a seeded token by prefix', async () => {
      const { entity } = await seedAgentToken(h.container, { name: 'ci-runner' });

      const res = await h.app.inject({ method: 'GET', url: '/api/agent-tokens' });

      expect(res.statusCode).toBe(200);
      const list = res.json<AgentToken[]>();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: entity.id,
        name: 'ci-runner',
        prefix: entity.prefix,
        lastUsedAt: null,
      });
    });

    it('SECURITY: never exposes the raw secret, only the 8-char prefix', async () => {
      const { entity, secret } = await seedAgentToken(h.container, { name: 'ci-runner' });

      const res = await h.app.inject({ method: 'GET', url: '/api/agent-tokens' });

      expect(res.statusCode).toBe(200);
      const list = res.json<AgentToken[]>();
      const token = list[0];
      expect(token).toBeDefined();

      // (a) No `secret` key at all.
      expect(token).not.toHaveProperty('secret');
      // (b) Not the hash either — it is offline-crackable material.
      expect(token).not.toHaveProperty('hashedSecret');
      // (c) Raw-text check: catches a leak under ANY key name, at any depth.
      expect(res.body).not.toContain(secret);
      expect(res.body).not.toContain(entity.hashedSecret);
      // (d) What IS exposed is a non-reversible 8-char prefix.
      expect(token?.prefix).toBe(secret.slice(0, 8));
      expect(token?.prefix).toHaveLength(8);
      // Locked exhaustively so adding a field to the DTO is a reviewed change.
      expect(Object.keys(token ?? {}).sort()).toEqual(
        ['createdAt', 'id', 'lastUsedAt', 'name', 'prefix'].sort(),
      );
    });
  });

  describe('POST /api/agent-tokens', () => {
    it('answers 201 and returns the raw secret — the only time it ever will', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agent-tokens',
        payload: { name: 'deploy-bot' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json<AgentTokenCreated>();
      expect(created.name).toBe('deploy-bot');
      expect(created.secret).toMatch(/^fleex_[0-9a-f]{64}$/);
      expect(created.prefix).toBe(created.secret.slice(0, 8));

      // The secret is genuine: its hash is what the store holds, which is what
      // the auth middleware looks up. A placeholder string would not match.
      const stored = await h.container.agentTokenStore.getByHash(
        ApiTokenEntity.hashToken(created.secret),
      );
      expect(stored?.id).toBe(created.id);
    });

    it('never returns the secret again — it is unrecoverable after creation', async () => {
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/agent-tokens',
        payload: { name: 'deploy-bot' },
      });
      expect(create.statusCode).toBe(201);
      const secret = create.json<AgentTokenCreated>().secret;

      const list = await h.app.inject({ method: 'GET', url: '/api/agent-tokens' });

      expect(list.statusCode).toBe(200);
      expect(list.json<AgentToken[]>()).toHaveLength(1);
      expect(list.body).not.toContain(secret);
    });

    it('answers 400 when `name` is missing', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agent-tokens',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'name is required' });
    });

    it('answers 400 on an empty `name` — the guard is falsy, not just undefined', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agent-tokens',
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'name is required' });
    });

    it('answers 400 on a non-string `name`', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agent-tokens',
        payload: { name: 42 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'name is required' });
    });

    it('does not persist anything when the request is rejected', async () => {
      const bad = await h.app.inject({ method: 'POST', url: '/api/agent-tokens', payload: {} });
      expect(bad.statusCode).toBe(400);

      const list = await h.app.inject({ method: 'GET', url: '/api/agent-tokens' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);
    });

    /**
     * ⚠️  KNOWN BUG, LOCKED ON PURPOSE.
     *
     * With NO body at all (no payload, hence no content-type), Fastify leaves
     * `request.body` as `undefined`. The handler destructures it immediately —
     * `const { name } = request.body` — which throws a TypeError before the
     * `if (!name)` guard can run. The error handler turns that into a 500 whose
     * message leaks an internal V8 string:
     *
     *   "Cannot destructure property 'name' of 'request.body' as it is undefined."
     *
     * It SHOULD be 400 `{ error: 'name is required' }`, exactly like `{}` — the
     * caller made the same client-side mistake, and a 500 tells monitoring the
     * server is broken when it is not.
     *
     * The fix (`const { name } = request.body ?? {}`, or a JSON body schema) is
     * a separate ticket. Locked here so the fix shows up in review as a
     * deliberate red→green diff.
     */
    it('answers 500 on a body-less POST (known bug — should be 400, see comment)', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/api/agent-tokens' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: 'INTERNAL_ERROR',
        message: "Cannot destructure property 'name' of 'request.body' as it is undefined.",
      });
    });
  });

  describe('DELETE /api/agent-tokens/:id', () => {
    it('answers 204 with an empty body and revokes the token', async () => {
      const { entity } = await seedAgentToken(h.container, { name: 'to-revoke' });

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/agent-tokens/${entity.id}`,
      });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      const list = await h.app.inject({ method: 'GET', url: '/api/agent-tokens' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);
      // Revoked for real: the hash lookup the auth middleware performs is dead.
      expect(await h.container.agentTokenStore.getByHash(entity.hashedSecret)).toBeNull();
    });

    it('answers 204 on an unknown id — revocation is idempotent, not 404', async () => {
      const res = await h.app.inject({
        method: 'DELETE',
        url: '/api/agent-tokens/does-not-exist',
      });

      // Deliberate: `store.remove` is a no-op on a missing row and the handler
      // never checks. Re-running a revocation script must not fail.
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    });

    it('deletes only the targeted token', async () => {
      const keep = await seedAgentToken(h.container, { name: 'keep' });
      const drop = await seedAgentToken(h.container, { name: 'drop' });

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/agent-tokens/${drop.entity.id}`,
      });
      expect(res.statusCode).toBe(204);

      const list = await h.app.inject({ method: 'GET', url: '/api/agent-tokens' });
      expect(list.statusCode).toBe(200);
      const remaining = list.json<AgentToken[]>();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(keep.entity.id);
    });
  });
});
