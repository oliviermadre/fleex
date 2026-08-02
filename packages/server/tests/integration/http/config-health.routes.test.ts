import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import type { AppConfig } from '../../../src/application/ports/config.port.js';

/**
 * `GET /health` and `/api/config` are the two routes every other client hits
 * first: the health probe gates deployment, `/api/config` gates the whole web
 * boot. A status change on either is a full outage, so both are locked here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ENV READ TIMING — this is what makes the suite non-trivial
 * ────────────────────────────────────────────────────────────────────────────
 * The two env vars involved are read at DIFFERENT moments:
 *
 *  - `FLEEX_REPOSITORIES_BASE_PATH` is read ONCE, inside `JsonConfigAdapter.init()`
 *    (via `applyBasePathEnvOverride`), i.e. while `createTestApp()` builds the
 *    container. Stubbing it after boot has no effect → it must be stubbed in
 *    `beforeEach`, BEFORE `createTestApp`.
 *  - `FLEEX_WORKSPACE` is read PER REQUEST, inside the `GET /api/config`
 *    handler. It can therefore be stubbed after boot — and one test below
 *    proves exactly that, because it is the property the CLI relies on.
 *
 * Both vars are set in a real Fleex dev shell (the CLI injects them), so every
 * test pins them explicitly rather than inheriting the ambient environment —
 * otherwise the suite would pass on a dev machine and fail on CI, or worse.
 */

/** Pinned so `basePath` is byte-for-byte predictable on any machine. */
const BASE_PATH = '/tmp/fleex-integration-base-path';

describe('health + config routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    vi.stubEnv('FLEEX_REPOSITORIES_BASE_PATH', BASE_PATH);
    // Absent by default: the "no workspace" case is the interesting baseline.
    vi.stubEnv('FLEEX_WORKSPACE', undefined);
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
    vi.unstubAllEnvs();
  });

  describe('GET /health', () => {
    it('answers 200 with { status, tmux, uptime } and nothing else', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; tmux: boolean; uptime: number }>();
      expect(body.status).toBe('ok');
      // The container wires FakeTmuxPort, whose isAvailable() is true. The
      // point of the assertion is that the route AWAITS the port rather than
      // hard-coding a literal.
      expect(body.tmux).toBe(true);
      // Locked exhaustively: the health payload is a public contract for
      // uptime monitors, so an added/removed key must be a reviewed change.
      expect(Object.keys(body).sort()).toEqual(['status', 'tmux', 'uptime']);
    });

    it('reports uptime as a whole number of seconds', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      const { uptime } = res.json<{ uptime: number }>();
      // `startTime` is a MODULE-level constant, so uptime counts from first
      // import of health.routes.ts, not from app boot. It is therefore only
      // guaranteed to be a non-negative integer.
      expect(Number.isInteger(uptime)).toBe(true);
      expect(uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /api/config', () => {
    it('answers 200 with the persisted config, basePath included', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/config' });

      expect(res.statusCode).toBe(200);
      const body = res.json<AppConfig>();
      expect(body.basePath).toBe(BASE_PATH);
      expect(typeof body.defaultShell).toBe('string');
      expect(body.repositoryRefreshIntervalMs).toBe(0);
    });

    it('omits `workspace` entirely when FLEEX_WORKSPACE is unset', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/config' });

      expect(res.statusCode).toBe(200);
      // Absent, not `null` / `''` — the web checks with `if (config.workspace)`.
      expect(res.json()).not.toHaveProperty('workspace');
    });

    it('exposes `workspace` when FLEEX_WORKSPACE is set', async () => {
      vi.stubEnv('FLEEX_WORKSPACE', 'acme');

      const res = await h.app.inject({ method: 'GET', url: '/api/config' });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ workspace?: string }>().workspace).toBe('acme');
    });

    it('re-reads FLEEX_WORKSPACE on every request, not once at construction', async () => {
      // Same app instance throughout: this is the whole point. The CLI can flip
      // the workspace of a running server, and the web must see it.
      const before = await h.app.inject({ method: 'GET', url: '/api/config' });
      expect(before.statusCode).toBe(200);
      expect(before.json()).not.toHaveProperty('workspace');

      vi.stubEnv('FLEEX_WORKSPACE', 'switched');

      const after = await h.app.inject({ method: 'GET', url: '/api/config' });
      expect(after.statusCode).toBe(200);
      expect(after.json<{ workspace?: string }>().workspace).toBe('switched');
    });

    it('treats a blank FLEEX_WORKSPACE as unset', async () => {
      vi.stubEnv('FLEEX_WORKSPACE', '   ');

      const res = await h.app.inject({ method: 'GET', url: '/api/config' });

      expect(res.statusCode).toBe(200);
      // `?.trim() || undefined` — a whitespace-only value must not leak through.
      expect(res.json()).not.toHaveProperty('workspace');
    });
  });

  describe('PUT /api/config', () => {
    it('answers 200 and persists an updatable key', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/config',
        payload: { humanDisplayName: 'Alice', agentMaxConcurrency: 7 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<AppConfig>().humanDisplayName).toBe('Alice');

      // Read back through HTTP — the round-trip is what proves persistence.
      const read = await h.app.inject({ method: 'GET', url: '/api/config' });
      expect(read.statusCode).toBe(200);
      const body = read.json<AppConfig>();
      expect(body.humanDisplayName).toBe('Alice');
      expect(body.agentMaxConcurrency).toBe(7);
    });

    it('IGNORES basePath — it belongs to ~/.fleex/workspaces.json, not the DB', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/config',
        payload: { basePath: '/somewhere/else', humanMentionName: 'alice' },
      });

      expect(res.statusCode).toBe(200);
      // 200, not 400: the handler silently strips the key rather than rejecting.
      expect(res.json<AppConfig>().basePath).toBe(BASE_PATH);
      expect(res.json<AppConfig>().humanMentionName).toBe('alice');

      const read = await h.app.inject({ method: 'GET', url: '/api/config' });
      expect(read.statusCode).toBe(200);
      expect(read.json<AppConfig>().basePath).toBe(BASE_PATH);
    });

    it('IGNORES workspace — it is env-derived, echoed on GET, never stored', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/config',
        payload: { workspace: 'injected-by-client', defaultShell: '/bin/bash' },
      });

      expect(res.statusCode).toBe(200);
      // The PUT response is `config.get()`, which has no workspace notion at all.
      expect(res.json()).not.toHaveProperty('workspace');
      expect(res.json<AppConfig>().defaultShell).toBe('/bin/bash');

      // And it did not sneak into storage: FLEEX_WORKSPACE is still unset, so
      // GET must stay silent about workspace.
      const read = await h.app.inject({ method: 'GET', url: '/api/config' });
      expect(read.statusCode).toBe(200);
      expect(read.json()).not.toHaveProperty('workspace');
    });

    it('leaves untouched keys alone across successive PUTs', async () => {
      const first = await h.app.inject({
        method: 'PUT',
        url: '/api/config',
        payload: { humanDisplayName: 'Alice' },
      });
      expect(first.statusCode).toBe(200);

      const second = await h.app.inject({
        method: 'PUT',
        url: '/api/config',
        payload: { agentExecutionTimeout: 900 },
      });
      expect(second.statusCode).toBe(200);
      // `update()` is a shallow merge, not a replace.
      expect(second.json<AppConfig>().humanDisplayName).toBe('Alice');
      expect(second.json<AppConfig>().agentExecutionTimeout).toBe(900);
    });

    /**
     * NOT COVERED HERE: the `Array.isArray(body.repositories)` branch, which
     * calls `repositoryResolver.resolve` + `repositoryRefreshScheduler.refresh`
     * + `bareCloneManager.syncWithConfig`. The integration container stubs the
     * scheduler with `refreshNow` (not `refresh`), so that branch answers 500
     * for a reason that lives in the TEST helper, not in `src/`. Locking that
     * would lock a fixture artefact. It needs a scheduler fake first — see the
     * PR description.
     */
  });
});
