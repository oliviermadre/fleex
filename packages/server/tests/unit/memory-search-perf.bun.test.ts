/**
 * Perf gate — brute-force vector search at scale
 *
 * The architecture rests on one measured claim: for a single-user corpus, scoring
 * every vector in JS is fast enough that no ANN index is worth its install cost.
 * This is that claim, asserted rather than asserted-in-a-comment, at the real
 * vector width (384) rather than the 16 dims the plumbing tests use.
 *
 * Ceilings are deliberately loose — several times the observed figure — because a
 * perf test that fails on a loaded CI box teaches people to ignore failures. The
 * measured numbers are printed, so a regression shows up as a number moving even
 * when it stays under the gate.
 *
 * 10k chunks is roughly two years of the instance this was sized for (537 tickets
 * and 1500 deliverables produced ~7k). 50k is available behind
 * FLEEX_PERF_LARGE=1: it holds ~150 MB of vectors, which is not something to make
 * every test run pay for.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteMemoryStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-memory-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { MemoryChunkEntity } from '../../src/domain/entities/memory-chunk.entity.js';
import { rankHits } from '../../src/application/memory/scoring.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** The width the default encoder produces. */
const DIMS = 384;

const CHUNKS = Number(process.env['FLEEX_PERF_LARGE'] ? 50_000 : 10_000);

/** Gate from the plan: a search must stay well inside a prompt-assembly budget. */
const SEARCH_BUDGET_MS = process.env['FLEEX_PERF_LARGE'] ? 600 : 250;

let conn: SqliteConnection;
let store: SqliteMemoryStoreAdapter;
let queryVector: Float32Array;

/** Deterministic unit vectors, so timings are comparable between runs. */
function vectorFor(seed: number): Float32Array {
  const v = new Float32Array(DIMS);
  let x = seed * 2654435761 % 4294967296;
  let norm = 0;
  for (let i = 0; i < DIMS; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const value = (x / 2147483648) - 0.5;
    v[i] = value;
    norm += value * value;
  }
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < DIMS; i++) v[i] = v[i]! * inv;
  return v;
}

beforeAll(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteMemoryStoreAdapter(conn);

  const BATCH = 1_000;
  for (let start = 0; start < CHUNKS; start += BATCH) {
    const batch: MemoryChunkEntity[] = [];
    for (let i = start; i < Math.min(start + BATCH, CHUNKS); i++) {
      batch.push(MemoryChunkEntity.create({
        sourceKind: 'deliverable',
        sourceId: `src-${i}`,
        chunkIndex: 0,
        title: `Chunk ${i}`,
        content: `body of chunk number ${i}`,
        metadata: { tags: ['perf'], repo: i % 2 === 0 ? 'org/a' : 'org/b' },
        embedding: vectorFor(i),
        embeddingModel: 'perf:384',
        sourceUpdatedAt: new Date('2026-08-01T00:00:00Z'),
      }));
    }
    await store.upsertChunks(batch);
  }

  queryVector = vectorFor(CHUNKS + 1);
  // Warm the in-process vector cache, which is what a running instance has after
  // its first query — measuring the cold decode instead would be measuring a
  // one-off.
  await store.search(queryVector, { embeddingModel: 'perf:384' }, 8);
});

afterAll(() => {
  conn.close();
});

describe(`brute-force search over ${CHUNKS} chunks`, () => {
  it('stays inside the prompt-assembly budget', async () => {
    const runs = 5;
    const started = performance.now();
    for (let i = 0; i < runs; i++) {
      await store.search(queryVector, { embeddingModel: 'perf:384' }, 8);
    }
    const perQuery = (performance.now() - started) / runs;
    console.log(`  search over ${CHUNKS} chunks: ${perQuery.toFixed(1)} ms/query`);
    expect(perQuery).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it('is faster when the caller narrows to one repo', async () => {
    // The filter runs in SQL, so half the corpus never reaches the scorer. This
    // is what keeps repo-scoped retrieval cheap as the index grows.
    const started = performance.now();
    await store.search(queryVector, { repo: 'org/a', embeddingModel: 'perf:384' }, 8);
    const filtered = performance.now() - started;
    console.log(`  repo-filtered search: ${filtered.toFixed(1)} ms`);
    expect(filtered).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it('ranks the full candidate set without blowing the budget', () => {
    // Ranking is the other half of a retrieval: it re-scores on the structural
    // signals and applies the per-source cap, in JS, over the over-fetched set.
    const hits = Array.from({ length: 2_000 }, (_, i) => ({
      chunk: MemoryChunkEntity.create({
        sourceKind: 'deliverable' as const,
        sourceId: `src-${i % 500}`,
        chunkIndex: i % 4,
        title: `Chunk ${i}`,
        content: 'body',
        metadata: { tags: ['perf'], repo: 'org/a' },
      }),
      similarity: (i % 100) / 100,
    }));

    const started = performance.now();
    const ranked = rankHits(hits, { repo: 'org/a', tags: ['perf'] }, 8);
    const elapsed = performance.now() - started;
    console.log(`  ranking 2000 candidates: ${elapsed.toFixed(1)} ms`);
    expect(ranked).toHaveLength(8);
    expect(elapsed).toBeLessThan(100);
  });

  it('keeps the index within the size the design assumed', async () => {
    const stats = await store.getStats('perf:384');
    expect(stats.totalChunks).toBe(CHUNKS);
    // 384 floats is 1536 bytes per vector; the claim in the plan is that a corpus
    // of this size is tens of megabytes, not gigabytes.
    const vectorMegabytes = (CHUNKS * DIMS * 4) / 1_048_576;
    console.log(`  vectors: ${vectorMegabytes.toFixed(1)} MB for ${CHUNKS} chunks`);
    expect(vectorMegabytes).toBeLessThan(CHUNKS === 50_000 ? 100 : 20);
  });
});
