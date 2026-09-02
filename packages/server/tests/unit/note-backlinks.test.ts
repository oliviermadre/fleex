import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { scratchpadRoutes } from '../../src/infrastructure/http/scratchpad.routes.js';
import type { AppConfig } from '../../src/application/ports/config.port.js';

// ---------------------------------------------------------------------------
// Navigating between notes reads no index, so backlinks must survive the legacy
// engine and a disabled flag — exactly as @ticket: always has. Only the
// `related` half queries the retrieval index, so only it answers to the flag.
// These tests pin that split at the payload level.
// ---------------------------------------------------------------------------

const NOTES: Record<string, string> = {
  'scratchpad:__global__': 'index of everything, conventions in @scratchpad:acme/app',
  'scratchpad:acme/app': 'repo notes. see @scratchpad:global for the index, and @scratchpad:acme/app itself',
  'scratchpad:acme/other': 'unrelated prose about scratchpads in general',
};

function makeContainer(config: Partial<AppConfig>) {
  return {
    config: { get: () => config as AppConfig },
    kvStore: {
      get: async (key: string) => NOTES[key] ?? null,
      listByPrefix: async () => Object.entries(NOTES).map(([key, value]) => ({ key, value })),
      set: async () => {},
    },
    // Reached only when the related half is live; returning a hit lets us prove
    // the flag is what silences it, not an empty index.
    retrieveContext: {
      search: async () => [{ sourceId: 'acme/app', score: 0.9 }],
    },
    eventBus: { emit: () => {} },
    hostFs: { exists: async () => false, readFile: async () => '' },
    hostHomedir: '/tmp/fleex-test-home',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function links(config: Partial<AppConfig>, key: string, target: string) {
  const app: FastifyInstance = Fastify({ logger: false });
  await app.register(scratchpadRoutes(makeContainer(config)));
  await app.ready();
  const res = await app.inject({
    method: 'GET',
    url: `/api/scratchpads/links?key=${encodeURIComponent(key)}&target=${encodeURIComponent(target)}`,
  });
  expect(res.statusCode).toBe(200);
  await app.close();
  return res.json() as { backlinks: Array<{ key: string; label: string }>; related: Array<{ key: string }> };
}

const SEMANTIC = { memoryEngine: 'semantic' as const };
const LEGACY = { memoryEngine: 'legacy' as const };

describe('GET /api/scratchpads/links', () => {
  it('reports who references the global note', async () => {
    const body = await links(SEMANTIC, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).toEqual(['acme/app']);
  });

  it('labels the global note Global rather than its storage key', async () => {
    const body = await links(SEMANTIC, 'acme/app', 'acme/app');
    expect(body.backlinks).toEqual([{ key: '__global__', label: 'Global' }]);
  });

  it('does not list a note as its own backlink', async () => {
    // acme/app references global, and global references acme/app; asking about
    // acme/app from acme/app must not return acme/app.
    const body = await links(SEMANTIC, 'acme/app', 'acme/app');
    expect(body.backlinks.map((b) => b.key)).not.toContain('acme/app');
  });

  it('ignores prose that merely talks about scratchpads', async () => {
    const body = await links(SEMANTIC, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).not.toContain('acme/other');
  });

  it('returns backlinks under the legacy engine', async () => {
    // The whole point of this task: a text scan over a handful of notes needs no
    // index, so it must not answer to the memory engine.
    const body = await links(LEGACY, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).toEqual(['acme/app']);
    expect(body.related).toEqual([]);
  });

  it('returns backlinks when relatedNotes is off, and no related', async () => {
    const body = await links({ ...SEMANTIC, memoryFeatures: { relatedNotes: false } }, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).toEqual(['acme/app']);
    expect(body.related).toEqual([]);
  });

  it('returns related notes when the flag and the engine are both on', async () => {
    const body = await links(SEMANTIC, '__global__', '__global__');
    expect(body.related.map((r) => r.key)).toEqual(['acme/app']);
  });
});
