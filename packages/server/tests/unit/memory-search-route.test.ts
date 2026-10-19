import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { memoryRoutes } from '../../src/infrastructure/http/memory.routes.js';
import type { Container } from '../../src/infrastructure/container.js';

function setup(results: unknown[] = [], searchable = 0) {
  const retrieveContext = {
    isSemanticEnabled: () => true,
    search: vi.fn(async () => results),
    countSearchable: vi.fn(async () => searchable),
  };
  const app = Fastify();
  void app.register(memoryRoutes({ retrieveContext } as unknown as Container));
  return { app, retrieveContext };
}

const hit = { sourceKind: 'persona', sourceId: 'p1', title: 'p1', content: 'x', score: 0.5 };

describe('GET /api/memory/search — kind parameter', () => {
  it('passes no kinds when the parameter is absent, and keeps the response shape unchanged', async () => {
    const { app, retrieveContext } = setup([hit]);
    const res = await app.inject({ url: '/api/memory/search?q=x' });
    expect(retrieveContext.search).toHaveBeenCalledWith(expect.objectContaining({ kinds: undefined }));
    // No `scope` on an unfiltered search: existing consumers see exactly what they did.
    expect(res.json()).toEqual({ query: 'x', results: [hit] });
  });

  it('splits a comma-separated list into kinds for the store', async () => {
    const { app, retrieveContext } = setup([hit]);
    await app.inject({ url: '/api/memory/search?q=x&kind=qa_pair,curated_note' });
    expect(retrieveContext.search).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ['qa_pair', 'curated_note'] }),
    );
  });

  it('rejects an unknown kind before searching, rather than ignoring it', async () => {
    const { app, retrieveContext } = setup([hit]);
    const res = await app.inject({ url: '/api/memory/search?q=x&kind=persona,personas' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Unknown kind "personas"\. Expected one of: ticket, /);
    expect(retrieveContext.search).not.toHaveBeenCalled();
  });

  it('counts the searchable scope only when a filtered search came back empty', async () => {
    const empty = setup([], 23);
    const res = await empty.app.inject({ url: '/api/memory/search?q=x&kind=persona&repo=org/app' });
    expect(res.json().scope).toEqual({ kinds: ['persona'], repo: 'org/app', searchableChunks: 23 });
    expect(empty.retrieveContext.countSearchable).toHaveBeenCalledWith({ kinds: ['persona'], repo: 'org/app' });

    // A populated result already proves the scope was not empty: no extra query.
    const full = setup([hit]);
    const res2 = await full.app.inject({ url: '/api/memory/search?q=x&kind=persona' });
    expect(res2.json().scope).toEqual({ kinds: ['persona'], repo: null });
    expect(full.retrieveContext.countSearchable).not.toHaveBeenCalled();
  });
});
