/**
 * `GET /api/memory/search?kind=…` against the real SQLite store.
 *
 * The bug this pins: the kind filter used to be applied to the ranked top ten,
 * not to the index. On a live corpus of 30,000 chunks, 24,000 of them
 * deliverables, the 23 personas never reached the top ten of any query, so
 * `--kind persona` answered an empty list — silently. The fixture reproduces the
 * shape that hid it: a sparse kind far less similar to the query than a flood of
 * another kind. A kind that wins on similarity anyway would pass by accident.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteMemoryStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-memory-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { MemoryChunkEntity, type MemorySourceKind } from '../../src/domain/entities/memory-chunk.entity.js';
import { RetrieveContextUseCase } from '../../src/application/use-cases/retrieve-context.js';
import { memoryRoutes } from '../../src/infrastructure/http/memory.routes.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import type { Container } from '../../src/infrastructure/container.js';
import type { ConfigPort } from '../../src/application/ports/config.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const QUERY = 'deploy pipeline release rollback';

let conn: SqliteConnection;
let app: FastifyInstance;

async function seed(store: SqliteMemoryStoreAdapter, provider: FakeEmbeddingProvider) {
  const make = async (kind: MemorySourceKind, sourceId: string, content: string, repo: string | null = null) => {
    const [embedding] = await provider.embedPassages([content]);
    return MemoryChunkEntity.create({
      sourceKind: kind, sourceId, chunkIndex: 0, title: sourceId, content,
      metadata: { repo }, embedding: embedding!, embeddingModel: provider.id,
    });
  };
  const chunks: MemoryChunkEntity[] = [];
  // The flood: each one a near-copy of the query, so all of them outrank any persona.
  for (let i = 0; i < 200; i++) {
    chunks.push(await make('deliverable', `d${i}`, `${QUERY} notes ${i}`, i % 2 ? 'org/app' : null));
  }
  // The sparse kind: one shared word with the query, nothing more.
  chunks.push(await make('persona', 'p1', 'persona builder ships deploy'));
  chunks.push(await make('persona', 'p2', 'persona reviewer reads code'));
  chunks.push(await make('persona', 'p3', 'persona planner writes specs', 'org/app'));
  await store.upsertChunks(chunks);
}

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  const store = new SqliteMemoryStoreAdapter(conn);
  const provider = new FakeEmbeddingProvider();
  await provider.init();
  await seed(store, provider);

  const config = { get: () => ({ memoryEngine: 'semantic' }) } as unknown as ConfigPort;
  const retrieveContext = new RetrieveContextUseCase(
    config, { execute: async () => [] } as never, {} as never, silent as never, store, provider,
  );
  app = Fastify();
  await app.register(memoryRoutes({ retrieveContext, config, logger: silent } as unknown as Container));
});

afterEach(async () => {
  await app.close();
  conn.close();
});

async function search(qs: string) {
  const res = await app.inject({ method: 'GET', url: `/api/memory/search?q=${encodeURIComponent(QUERY)}&${qs}` });
  return { status: res.statusCode, body: res.json() as {
    results: Array<{ sourceKind: string; sourceId: string }>;
    scope?: { kinds: string[] | null; repo: string | null; searchableChunks?: number };
    error?: string;
  } };
}

describe('kind filter on /api/memory/search', () => {
  it('shows the trap: unfiltered, the top ten holds no persona at all', async () => {
    const { body } = await search('limit=10');
    expect(body.results).toHaveLength(10);
    expect(body.results.some((r) => r.sourceKind === 'persona')).toBe(false);
  });

  it('returns every persona when filtering by kind, however outranked they are globally', async () => {
    const { status, body } = await search('kind=persona&limit=10');
    expect(status).toBe(200);
    expect(body.results.map((r) => r.sourceId).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(body.results.every((r) => r.sourceKind === 'persona')).toBe(true);
  });

  it('combines kind and repo in the store', async () => {
    const { body } = await search('kind=persona&repo=org/app');
    expect(body.results.map((r) => r.sourceId)).toEqual(['p3']);
  });

  it('says the scope was empty when a valid kind has nothing indexed', async () => {
    const { status, body } = await search('kind=curated_note');
    expect(status).toBe(200);
    expect(body.results).toEqual([]);
    expect(body.scope).toEqual({ kinds: ['curated_note'], repo: null, searchableChunks: 0 });
  });

  it('rejects an unknown kind instead of running an unfiltered search', async () => {
    const { status, body } = await search('kind=personas');
    expect(status).toBe(400);
    expect(body.error).toContain('Unknown kind "personas"');
    expect(body.error).toContain('persona');
  });
});
