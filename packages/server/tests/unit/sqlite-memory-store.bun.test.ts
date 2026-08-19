/**
 * Integration tests — SQLite memory store
 *
 * Exercises the retrieval index against the real `bun:sqlite` connection and the
 * real migration chain: BLOB round-tripping, upsert-by-natural-key, the
 * structural filters, and the pending-embedding sweep. Retrieval *quality* is
 * out of scope here (see the eval harness); what is asserted is that the store
 * returns what was put in, in the order similarity dictates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteMemoryStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-memory-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { MemoryChunkEntity, hashChunkContent } from '../../src/domain/entities/memory-chunk.entity.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import type { MemoryChunkMetadata, MemorySourceKind } from '../../src/domain/entities/memory-chunk.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteMemoryStoreAdapter;
let provider: FakeEmbeddingProvider;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteMemoryStoreAdapter(conn);
  provider = new FakeEmbeddingProvider();
  await provider.init();
});

afterEach(() => {
  conn.close();
});

async function chunk(params: {
  sourceKind?: MemorySourceKind;
  sourceId: string;
  chunkIndex?: number;
  content: string;
  title?: string;
  metadata?: MemoryChunkMetadata;
  embed?: boolean;
  sourceUpdatedAt?: Date | null;
}): Promise<MemoryChunkEntity> {
  const [embedding] = params.embed === false ? [null] : await provider.embedPassages([params.content]);
  return MemoryChunkEntity.create({
    sourceKind: params.sourceKind ?? 'deliverable',
    sourceId: params.sourceId,
    chunkIndex: params.chunkIndex ?? 0,
    title: params.title ?? params.sourceId,
    content: params.content,
    metadata: params.metadata ?? {},
    embedding: embedding ?? null,
    embeddingModel: embedding ? provider.id : null,
    sourceUpdatedAt: params.sourceUpdatedAt ?? new Date('2026-08-01T00:00:00Z'),
  });
}

describe('vector round-trip', () => {
  it('returns the stored vector bit-for-bit', async () => {
    const original = await chunk({ sourceId: 'd1', content: 'database migration ordering' });
    await store.upsertChunks([original]);

    const [hit] = await store.search(original.embedding!, {}, 5);
    expect(hit).toBeDefined();
    expect(Array.from(hit!.chunk.embedding!)).toEqual(Array.from(original.embedding!));
    // Identical vectors are maximally similar; anything else means the BLOB was
    // mangled on the way in or out.
    expect(hit!.similarity).toBeCloseTo(1, 5);
  });

  it('preserves metadata across the round-trip', async () => {
    await store.upsertChunks([await chunk({
      sourceId: 'd1',
      content: 'auth rework',
      metadata: { ticketId: 't1', boardId: 'b1', repo: 'org/app', agentName: 'Builder', tags: ['auth', 'bug'] },
    })]);

    const [hit] = await store.search(await provider.embedQuery('auth rework'), {}, 5);
    expect(hit!.chunk.metadata).toEqual({
      ticketId: 't1', boardId: 'b1', repo: 'org/app', agentName: 'Builder', tags: ['auth', 'bug'],
    });
  });
});

describe('upsert by natural key', () => {
  it('replaces a chunk in place rather than duplicating it', async () => {
    await store.upsertChunks([await chunk({ sourceId: 'd1', chunkIndex: 0, content: 'first version' })]);
    await store.upsertChunks([await chunk({ sourceId: 'd1', chunkIndex: 0, content: 'second version' })]);

    const stats = await store.getStats();
    expect(stats.totalChunks).toBe(1);

    const found = await store.searchKeyword('second version', {}, 5);
    expect(found).toHaveLength(1);
    expect(await store.searchKeyword('first version', {}, 5)).toHaveLength(0);
  });

  it('keeps chunks of the same source distinct by index', async () => {
    await store.upsertChunks([
      await chunk({ sourceId: 'd1', chunkIndex: 0, content: 'part one' }),
      await chunk({ sourceId: 'd1', chunkIndex: 1, content: 'part two' }),
    ]);
    expect((await store.getStats()).totalChunks).toBe(2);
  });

  it('reports stored hashes so unchanged chunks need no re-embedding', async () => {
    const c = await chunk({ sourceId: 'd1', chunkIndex: 0, content: 'stable content' });
    await store.upsertChunks([c]);

    const hashes = await store.getHashesBySource('deliverable', 'd1');
    expect(hashes.get(0)).toBe(c.contentHash);
    // Same text and same model must hash identically, or every backfill would
    // re-embed the whole corpus.
    expect(hashes.get(0)).toBe(hashChunkContent('stable content', provider.id));
  });
});

describe('deletion', () => {
  it('removes every chunk of a source', async () => {
    await store.upsertChunks([
      await chunk({ sourceId: 'd1', chunkIndex: 0, content: 'a' }),
      await chunk({ sourceId: 'd1', chunkIndex: 1, content: 'b' }),
      await chunk({ sourceId: 'd2', chunkIndex: 0, content: 'c' }),
    ]);

    await store.deleteBySource('deliverable', 'd1');
    const stats = await store.getStats();
    expect(stats.totalChunks).toBe(1);
  });

  it('trims trailing chunks after a source shrank', async () => {
    await store.upsertChunks([
      await chunk({ sourceId: 'd1', chunkIndex: 0, content: 'kept' }),
      await chunk({ sourceId: 'd1', chunkIndex: 1, content: 'dropped' }),
      await chunk({ sourceId: 'd1', chunkIndex: 2, content: 'dropped too' }),
    ]);

    // The source now yields only one chunk; the stale tail must not linger and
    // keep answering queries with text that no longer exists.
    await store.deleteBySourceFrom('deliverable', 'd1', 1);
    expect((await store.getStats()).totalChunks).toBe(1);
    expect(await store.searchKeyword('dropped', {}, 5)).toHaveLength(0);
  });
});

describe('search ordering and filters', () => {
  beforeEach(async () => {
    await store.upsertChunks([
      await chunk({
        sourceId: 'auth', content: 'authentication session token expiry',
        metadata: { repo: 'org/app', boardId: 'b1', ticketId: 't1' },
      }),
      await chunk({
        sourceId: 'deploy', content: 'kubernetes deployment rollout strategy',
        metadata: { repo: 'org/infra', boardId: 'b2', ticketId: 't2' },
      }),
      await chunk({
        sourceKind: 'scratchpad', sourceId: 'notes', content: 'authentication notes reminder',
        metadata: { repo: 'org/app' },
      }),
    ]);
  });

  it('orders by descending similarity', async () => {
    const hits = await store.search(await provider.embedQuery('authentication session token expiry'), {}, 5);
    expect(hits[0]!.chunk.sourceId).toBe('auth');
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.similarity).toBeGreaterThanOrEqual(hits[i]!.similarity);
    }
  });

  it('honours the limit', async () => {
    expect(await store.search(await provider.embedQuery('authentication'), {}, 1)).toHaveLength(1);
  });

  it('filters by source kind', async () => {
    const hits = await store.search(await provider.embedQuery('authentication'), { kinds: ['scratchpad'] }, 5);
    expect(hits.map((h) => h.chunk.sourceId)).toEqual(['notes']);
  });

  it('filters by repo', async () => {
    const hits = await store.search(await provider.embedQuery('deployment'), { repo: 'org/infra' }, 5);
    expect(hits.map((h) => h.chunk.sourceId)).toEqual(['deploy']);
  });

  it('filters by board', async () => {
    const hits = await store.search(await provider.embedQuery('authentication'), { boardId: 'b1' }, 5);
    expect(hits.map((h) => h.chunk.sourceId)).toEqual(['auth']);
  });

  it('excludes a ticket own content but keeps ticket-less chunks', async () => {
    const hits = await store.search(await provider.embedQuery('authentication'), { excludeTicketId: 't1' }, 5);
    const ids = hits.map((h) => h.chunk.sourceId);
    expect(ids).not.toContain('auth');
    // The scratchpad has no ticket; a naive `ticket_id <> ?` would drop it too.
    expect(ids).toContain('notes');
  });

  it('skips chunks with no vector', async () => {
    await store.upsertChunks([await chunk({ sourceId: 'pending', content: 'authentication pending', embed: false })]);
    const hits = await store.search(await provider.embedQuery('authentication pending'), {}, 10);
    expect(hits.map((h) => h.chunk.sourceId)).not.toContain('pending');
  });

  it('skips vectors of a different width instead of comparing incompatible spaces', async () => {
    const wide = new FakeEmbeddingProvider(32);
    await wide.init();
    const [vector] = await wide.embedPassages(['authentication from another model']);
    await store.upsertChunks([MemoryChunkEntity.create({
      sourceKind: 'deliverable', sourceId: 'other-model', chunkIndex: 0,
      title: 'other', content: 'authentication from another model',
      embedding: vector!, embeddingModel: wide.id,
    })]);

    const hits = await store.search(await provider.embedQuery('authentication'), {}, 10);
    expect(hits.map((h) => h.chunk.sourceId)).not.toContain('other-model');
  });
});

describe('keyword search', () => {
  beforeEach(async () => {
    await store.upsertChunks([
      await chunk({ sourceId: 'd1', content: 'the failure was ERR_CONN_RESET in packages/server/src/main.ts' }),
      await chunk({ sourceId: 'd2', content: 'unrelated prose about deployment' }),
    ]);
  });

  it('finds exact identifiers that embeddings blur away', async () => {
    const found = await store.searchKeyword('ERR_CONN_RESET', {}, 5);
    expect(found.map((c) => c.sourceId)).toEqual(['d1']);
  });

  it('matches on a file path', async () => {
    expect((await store.searchKeyword('packages/server/src/main.ts', {}, 5))).toHaveLength(1);
  });

  it('treats LIKE wildcards literally', async () => {
    // Unescaped, `%` would match every row and `_` any single character. Escaped,
    // each matches only itself: no row contains a percent sign, and the one row
    // returned for `_` is the one with a literal underscore in ERR_CONN_RESET.
    expect(await store.searchKeyword('%', {}, 5)).toHaveLength(0);
    expect((await store.searchKeyword('_', {}, 5)).map((c) => c.sourceId)).toEqual(['d1']);
  });

  it('returns nothing for a blank term', async () => {
    expect(await store.searchKeyword('   ', {}, 5)).toEqual([]);
  });

  it('applies the same structural filters as vector search', async () => {
    await store.upsertChunks([await chunk({
      sourceKind: 'scratchpad', sourceId: 'n1', content: 'ERR_CONN_RESET seen again', metadata: { repo: 'org/app' },
    })]);
    const found = await store.searchKeyword('ERR_CONN_RESET', { kinds: ['scratchpad'] }, 5);
    expect(found.map((c) => c.sourceId)).toEqual(['n1']);
  });
});

describe('embedding sweep', () => {
  it('lists chunks awaiting a vector, oldest first', async () => {
    await store.upsertChunks([
      await chunk({ sourceId: 'p1', content: 'first pending', embed: false }),
      await chunk({ sourceId: 'p2', content: 'second pending', embed: false }),
      await chunk({ sourceId: 'done', content: 'already embedded' }),
    ]);

    const pending = await store.listPendingEmbeddings(10);
    expect(pending.map((c) => c.sourceId).sort()).toEqual(['p1', 'p2']);
  });

  it('attaches vectors without touching content, making the rows searchable', async () => {
    const pendingChunk = await chunk({ sourceId: 'p1', content: 'deferred embedding content', embed: false });
    await store.upsertChunks([pendingChunk]);

    const pending = await store.listPendingEmbeddings(10);
    const vectors = await provider.embedPassages(pending.map((c) => c.content));
    await store.setEmbeddings(pending.map((c, i) => ({
      id: c.id, embedding: vectors[i]!, embeddingModel: provider.id,
      expectedContentHash: c.contentHash, contentHash: c.contentHash,
    })));

    expect((await store.getStats()).pendingEmbeddings).toBe(0);
    const hits = await store.search(await provider.embedQuery('deferred embedding content'), {}, 5);
    expect(hits[0]!.chunk.sourceId).toBe('p1');
    expect(hits[0]!.chunk.content).toBe('deferred embedding content');
  });

  it('refuses a vector whose chunk no longer holds the text it was computed from', async () => {
    const pendingChunk = await chunk({ sourceId: 'p1', content: 'original', embed: false });
    await store.upsertChunks([pendingChunk]);
    const [before] = await store.listPendingEmbeddings(10);

    // The source is re-ingested while the vector is in flight.
    await store.upsertChunks([await chunk({ sourceId: 'p1', content: 'rewritten', embed: false })]);

    const [vector] = await provider.embedPassages(['original']);
    await store.setEmbeddings([{
      id: before!.id, embedding: vector!, embeddingModel: provider.id,
      expectedContentHash: before!.contentHash, contentHash: before!.contentHash,
    }]);

    // Still pending, and still holding the new text: the stale vector was dropped
    // rather than attached to content it does not describe.
    const after = await store.listPendingEmbeddings(10);
    expect(after).toHaveLength(1);
    expect(after[0]!.content).toBe('rewritten');
  });

  it('returns the top hits in score order after hydrating them', async () => {
    // The scan phase reads ids only, so this proves the hydration keeps the
    // ranking rather than inheriting the order `IN (...)` happens to return.
    await store.upsertChunks([
      await chunk({ sourceId: 'a', content: 'session tokens expire early' }),
      await chunk({ sourceId: 'b', content: 'docker layer cache key' }),
      await chunk({ sourceId: 'c', content: 'session tokens rotate on refresh' }),
    ]);

    const hits = await store.search(await provider.embedQuery('session tokens'), {}, 3);
    expect(hits).toHaveLength(3);
    expect(hits[0]!.similarity).toBeGreaterThanOrEqual(hits[1]!.similarity);
    expect(hits[1]!.similarity).toBeGreaterThanOrEqual(hits[2]!.similarity);
    // And the hydrated rows carry their real content, not just ids.
    expect(hits[0]!.chunk.content).toContain('session tokens');
  });

  it('honours the limit exactly, even when everything matches', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await store.upsertChunks([await chunk({ sourceId: id, content: `shared vocabulary ${id}` })]);
    }
    expect(await store.search(await provider.embedQuery('shared vocabulary'), {}, 2)).toHaveLength(2);
  });
});

describe('stats and clear', () => {
  it('reports totals, per-kind counts and the models in use', async () => {
    await store.upsertChunks([
      await chunk({ sourceKind: 'ticket_summary', sourceId: 's1', content: 'summary one' }),
      await chunk({ sourceKind: 'ticket_summary', sourceId: 's2', content: 'summary two' }),
      await chunk({ sourceKind: 'scratchpad', sourceId: 'n1', content: 'a note', embed: false }),
    ]);

    const stats = await store.getStats();
    expect(stats.totalChunks).toBe(3);
    expect(stats.pendingEmbeddings).toBe(1);
    expect(stats.chunksByKind).toEqual({ ticket_summary: 2, scratchpad: 1 });
    expect(stats.embeddingModels).toEqual([provider.id]);
    expect(stats.lastIndexedAt).not.toBeNull();
  });

  it('empties the index, which is what a model change requires', async () => {
    await store.upsertChunks([await chunk({ sourceId: 'd1', content: 'anything' })]);
    await store.clear();
    expect((await store.getStats()).totalChunks).toBe(0);
    expect(await store.search(await provider.embedQuery('anything'), {}, 5)).toEqual([]);
  });
});

describe('vector cache coherence', () => {
  it('reflects writes made after a query warmed the cache', async () => {
    await store.upsertChunks([await chunk({ sourceId: 'first', content: 'alpha beta gamma' })]);
    // Warm the cache.
    await store.search(await provider.embedQuery('alpha beta gamma'), {}, 5);

    await store.upsertChunks([await chunk({ sourceId: 'second', content: 'delta epsilon zeta' })]);
    const hits = await store.search(await provider.embedQuery('delta epsilon zeta'), {}, 5);
    expect(hits[0]!.chunk.sourceId).toBe('second');
  });

  it('stops returning a chunk deleted after the cache was warmed', async () => {
    await store.upsertChunks([await chunk({ sourceId: 'gone', content: 'transient content here' })]);
    await store.search(await provider.embedQuery('transient content here'), {}, 5);

    await store.deleteBySource('deliverable', 'gone');
    expect(await store.search(await provider.embedQuery('transient content here'), {}, 5)).toEqual([]);
  });
});

describe('sampling for the benchmark', () => {
  it('spreads across the index instead of returning its head', async () => {
    // The benchmark used to sample through the keyword path, which orders by
    // recency — so it measured the newest rows and called it "this corpus".
    for (let i = 0; i < 60; i++) {
      await store.upsertChunks([await chunk({
        sourceId: `s${i}`, content: `body number ${i} with enough words to be indexed`,
        sourceUpdatedAt: new Date(2026, 0, 1 + i),
      })]);
    }

    const sample = await store.sampleChunks(20);
    expect(sample).toHaveLength(20);

    // Not simply the 20 most recent: at least one row from the older half.
    const indices = sample.map((c) => Number(c.sourceId.slice(1)));
    expect(Math.min(...indices)).toBeLessThan(30);
  });

  it('returns everything when the index is smaller than the sample', async () => {
    await store.upsertChunks([await chunk({ sourceId: 'only', content: 'the sole chunk here' })]);
    expect(await store.sampleChunks(50)).toHaveLength(1);
  });

  it('returns nothing for an empty index', async () => {
    expect(await store.sampleChunks(10)).toEqual([]);
  });
});
