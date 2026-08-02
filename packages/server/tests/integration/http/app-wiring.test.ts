import { describe, it, expect, afterEach } from 'vitest';
import type { RouteOptions } from 'fastify';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';

/**
 * Surface coverage for the ~300 registered routes.
 *
 * The inventory snapshot is the cheap half of the safety net: it can't tell you
 * a handler is correct, but it breaks loudly on a deleted route, a renamed
 * path, a changed method, a broken `/api/agents/v1` prefix, or a plugin that
 * silently failed to register. The diff is readable in review.
 */
describe('app wiring', () => {
  let h: TestAppHandle | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it('registers exactly the expected route table', async () => {
    const routes: string[] = [];
    h = await createTestApp({
      onRoute: (r: RouteOptions) => {
        const methods = Array.isArray(r.method) ? r.method : [r.method];
        for (const m of methods) routes.push(`${m} ${r.url}`);
      },
    });

    // Default options: workflowTemplates on (so /api/workflows/templates* is
    // present), workflowRunStore null (so /api/workflows/runs* is not), and
    // auth 'none' (so authRoutes only exposes GET /auth/status).
    await expect(`${routes.sort().join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/route-inventory.txt',
    );
  });

  it('answers 404 on an unknown path, with no SPA fallback', async () => {
    h = await createTestApp();
    const res = await h.app.inject({ method: 'GET', url: '/definitely/not/a/route' });
    expect(res.statusCode).toBe(404);
  });

  it('skips the workflow template routes when the store is absent', async () => {
    h = await createTestApp({ workflowTemplates: false });
    const res = await h.app.inject({ method: 'GET', url: '/api/workflows/templates' });
    expect(res.statusCode).toBe(404);
  });

  it('never registers the workflow run routes without a run store', async () => {
    h = await createTestApp();
    const res = await h.app.inject({ method: 'GET', url: '/api/workflows/runs' });
    expect(res.statusCode).toBe(404);
  });

  it('answers CORS preflight with the requesting origin', async () => {
    h = await createTestApp();
    const res = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/boards',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
