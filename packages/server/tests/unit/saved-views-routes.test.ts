import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { savedViewsRoutes } from '../../src/infrastructure/http/saved-views.routes.js';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';

function memoryKv(): KvStorePort & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
    listByPrefix: async (p) => [...data].filter(([k]) => k.startsWith(p)).map(([key, value]) => ({ key, value })),
  };
}

const view = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  name: 'ODYS AI',
  emoji: '🔭',
  filters: { boards: ['b1'], statuses: [] },
  display: { groupBy: 'priority', subGroupBy: null, sort: { key: 'default', dir: 'desc' } },
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
  ...over,
});

async function appWith(kvStore: KvStorePort | null) {
  const app = Fastify();
  await app.register(savedViewsRoutes({ kvStore }));
  return app;
}

describe('saved views routes', () => {
  it('round-trips the views under saved_views:<scope>, so another browser reads what this one saved', async () => {
    const kv = memoryKv();
    const app = await appWith(kv);

    expect((await app.inject({ method: 'GET', url: '/api/saved-views/work' })).json()).toEqual({ views: [] });

    const put = await app.inject({ method: 'PUT', url: '/api/saved-views/work', payload: { views: [view({ name: '  ODYS AI  ' })] } });
    expect(put.statusCode).toBe(200);
    expect(kv.data.has('saved_views:work')).toBe(true);

    const got = (await app.inject({ method: 'GET', url: '/api/saved-views/work' })).json() as { views: { name: string; filters: unknown }[] };
    expect(got.views).toHaveLength(1);
    // Names are stored trimmed; filters come back as the client sent them.
    expect(got.views[0]!.name).toBe('ODYS AI');
    expect(got.views[0]!.filters).toEqual({ boards: ['b1'], statuses: [] });
  });

  it('refuses names that the picker could not tell apart: empty, over 60 chars, duplicate ignoring case', async () => {
    const app = await appWith(memoryKv());
    const put = (views: unknown[]) => app.inject({ method: 'PUT', url: '/api/saved-views/work', payload: { views } });

    expect((await put([view({ name: '   ' })])).statusCode).toBe(400);
    expect((await put([view({ name: 'x'.repeat(61) })])).statusCode).toBe(400);
    expect((await put([view(), view({ id: 'v2', name: 'odys ai' })])).statusCode).toBe(400);
    expect((await put([view(), view({ id: 'v1', name: 'Other' })])).statusCode).toBe(400);
    expect((await put([view({ filters: null })])).statusCode).toBe(400);
    expect((await put([view(), view({ id: 'v2', name: 'Reviewing' })])).statusCode).toBe(200);
  });

  it('answers 501 without a KV store, so the client disables views instead of losing them', async () => {
    const app = await appWith(null);
    expect((await app.inject({ method: 'GET', url: '/api/saved-views/work' })).statusCode).toBe(501);
    expect((await app.inject({ method: 'PUT', url: '/api/saved-views/work', payload: { views: [] } })).statusCode).toBe(501);
  });

  it('only knows the work scope', async () => {
    const app = await appWith(memoryKv());
    expect((await app.inject({ method: 'GET', url: '/api/saved-views/focus' })).statusCode).toBe(404);
  });

  it('reads a corrupted document as no views rather than failing the screen', async () => {
    const kv = memoryKv();
    kv.data.set('saved_views:work', '{not json');
    const app = await appWith(kv);
    expect((await app.inject({ method: 'GET', url: '/api/saved-views/work' })).json()).toEqual({ views: [] });
  });
});
