import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { repositoryRoutes } from '../../src/infrastructure/http/repositories.routes.js';
import { RepositoryCache } from '../../src/domain/services/repository-cache.js';
import type { Container } from '../../src/infrastructure/container.js';

// gh < 2.101 writes its HTTP cache non-atomically: concurrent `gh … --search`
// calls can tear the cached SearchType introspection, after which EVERY
// `gh pr list --search` fails with this exact error until the entry is removed.
const GH_TORN_CACHE = new Error("Command failed: gh pr list\nError: invalid character '{' looking for beginning of object key string\n");

const openPr = {
  number: 1, title: 'Open one', headRefName: 'feat/a', isDraft: false,
  author: { login: 'me' }, assignees: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
};

async function appWith(execFn: Container['execFn']) {
  const container = {
    execFn,
    repositoryCache: new RepositoryCache(),
    githubGraphql: { getRateLimit: async () => ({ remaining: 5000 }) },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as Container;
  const app = Fastify();
  await app.register(repositoryRoutes(container));
  return { app, container };
}

describe('GET /api/repositories/:org/:name/pulls', () => {
  it('still returns the open PRs when the merged/closed --search calls fail', async () => {
    // WHY: the sidebar keys PR badges on the open list. A broken `gh --search`
    // must not blank it nor turn the whole poll into a 502 (→ toast every 2 min).
    const execFn = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('--search')) throw GH_TORN_CACHE;
      return { stdout: JSON.stringify([openPr]), stderr: '' };
    });
    const { app, container } = await appWith(execFn as unknown as Container['execFn']);

    const res = await app.inject({ method: 'GET', url: '/api/repositories/o/r/pulls' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ number: 1, headRefName: 'feat/a', state: 'open' })]);
    expect(container.logger.warn).toHaveBeenCalled();
  });

  it('does not cache a partial list, so the next poll retries the failed lists', async () => {
    let searchBroken = true;
    const execFn = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('--search')) {
        if (searchBroken) throw GH_TORN_CACHE;
        return { stdout: JSON.stringify([{ ...openPr, number: 2, headRefName: 'feat/b', mergedAt: '2026-10-20T00:00:00Z' }]), stderr: '' };
      }
      return { stdout: JSON.stringify([openPr]), stderr: '' };
    });
    const { app } = await appWith(execFn as unknown as Container['execFn']);

    await app.inject({ method: 'GET', url: '/api/repositories/o/r/pulls' });
    searchBroken = false;
    const res = await app.inject({ method: 'GET', url: '/api/repositories/o/r/pulls' });

    expect(res.json().map((p: { number: number }) => p.number)).toContain(2);
  });

  it('still answers 502 when the open list itself cannot be fetched', async () => {
    const execFn = vi.fn(async () => { throw new Error('gh: not logged in'); });
    const { app } = await appWith(execFn as unknown as Container['execFn']);

    const res = await app.inject({ method: 'GET', url: '/api/repositories/o/r/pulls' });

    expect(res.statusCode).toBe(502);
  });
});
