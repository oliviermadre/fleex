/**
 * Integration tests — memory ingestion kernel
 *
 * Runs against the real SQLite store, because the properties that matter here are
 * about what persists across calls: that a second ingestion of unchanged content
 * embeds nothing, that a shrunk source leaves no stale rows behind, and that a
 * failing provider defers instead of losing content.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteMemoryStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-memory-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { MemoryKernel } from '../../src/application/memory/memory-kernel.js';
import { chunkTicket } from '../../src/application/memory/chunker.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import type { EmbeddingProviderPort } from '../../src/application/ports/embedding-provider.port.js';
import type { DraftChunk } from '../../src/application/memory/chunker.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteMemoryStoreAdapter;
let provider: FakeEmbeddingProvider;
let kernel: MemoryKernel;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteMemoryStoreAdapter(conn);
  provider = new FakeEmbeddingProvider();
  await provider.init();
  kernel = new MemoryKernel(store, provider, silent as never);
});

afterEach(() => {
  conn.close();
});

function draft(index: number, content: string, sourceId = 'src-1'): DraftChunk {
  return {
    sourceKind: 'deliverable',
    sourceId,
    chunkIndex: index,
    title: `chunk ${index}`,
    content,
    metadata: { ticketId: 't1' },
    sourceUpdatedAt: new Date('2026-08-01T00:00:00Z'),
  };
}

describe('ingest is idempotent', () => {
  it('embeds on first pass and nothing on the second', async () => {
    const drafts = [draft(0, 'alpha content'), draft(1, 'beta content')];

    const first = await kernel.ingest('deliverable', 'src-1', drafts);
    expect(first).toMatchObject({ embedded: 2, unchanged: 0, deferred: 0 });

    provider.resetEmbedCallCount();
    const second = await kernel.ingest('deliverable', 'src-1', drafts);

    expect(second).toMatchObject({ embedded: 0, unchanged: 2 });
    // The point of hashing: a re-run must not pay the embedding cost again.
    expect(provider.getEmbedCallCount()).toBe(0);
  });

  it('re-embeds only the chunk whose content changed', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'alpha'), draft(1, 'beta')]);

    provider.resetEmbedCallCount();
    const outcome = await kernel.ingest('deliverable', 'src-1', [draft(0, 'alpha'), draft(1, 'beta revised')]);

    expect(outcome).toMatchObject({ embedded: 1, unchanged: 1 });
    expect(provider.getEmbedCallCount()).toBe(1);
  });

  it('re-embeds everything when the embedding model changes', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'alpha')]);

    // Vectors from two models do not share a space, so the hash covers the model
    // id and a switch must invalidate the rows rather than mix them.
    const otherModel = new FakeEmbeddingProvider();
    await otherModel.init();
    Object.defineProperty(otherModel, 'id', { value: 'fake:other-model' });
    const otherKernel = new MemoryKernel(store, otherModel as EmbeddingProviderPort, silent as never);

    const outcome = await otherKernel.ingest('deliverable', 'src-1', [draft(0, 'alpha')]);
    expect(outcome).toMatchObject({ embedded: 1, unchanged: 0 });
  });
});

describe('ingest trims what no longer exists', () => {
  it('removes trailing chunks after a source shrank', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'one'), draft(1, 'two'), draft(2, 'three')]);
    expect((await store.getStats()).totalChunks).toBe(3);

    const outcome = await kernel.ingest('deliverable', 'src-1', [draft(0, 'one')]);

    expect(outcome.removed).toBe(2);
    expect((await store.getStats()).totalChunks).toBe(1);
    // Content that no longer exists must stop answering queries.
    expect(await store.searchKeyword('three', {}, 5)).toHaveLength(0);
  });

  it('deletes the source entirely when it yields no chunks', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'something')]);
    await kernel.ingest('deliverable', 'src-1', []);
    expect((await store.getStats()).totalChunks).toBe(0);
  });

  it('forgets a source on request', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'a'), draft(1, 'b')]);
    await kernel.forget('deliverable', 'src-1');
    expect((await store.getStats()).totalChunks).toBe(0);
  });

  it('leaves other sources untouched', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'first source')]);
    await kernel.ingest('deliverable', 'src-2', [draft(0, 'second source', 'src-2')]);

    await kernel.forget('deliverable', 'src-1');
    const stats = await store.getStats();
    expect(stats.totalChunks).toBe(1);
  });
});

describe('a failing provider defers instead of losing content', () => {
  /** Throws on every embed, as a missing optional dependency would. */
  const brokenProvider: EmbeddingProviderPort = {
    id: 'fake:broken',
    dimensions: 16,
    init: async () => {},
    isReady: () => false,
    embedPassages: async () => { throw new Error('model not downloaded'); },
    embedQuery: async () => { throw new Error('model not downloaded'); },
  };

  it('stores the content unembedded rather than failing the ingestion', async () => {
    const broken = new MemoryKernel(store, brokenProvider, silent as never);

    const outcome = await broken.ingest('deliverable', 'src-1', [draft(0, 'captured anyway')]);

    expect(outcome).toMatchObject({ embedded: 0, deferred: 1 });
    const stats = await store.getStats();
    expect(stats.totalChunks).toBe(1);
    expect(stats.pendingEmbeddings).toBe(1);
    // Keyword search still finds it — only similarity has to wait.
    expect(await store.searchKeyword('captured anyway', {}, 5)).toHaveLength(1);
  });

  it('does not re-chunk a deferred row on the next pass', async () => {
    const broken = new MemoryKernel(store, brokenProvider, silent as never);
    await broken.ingest('deliverable', 'src-1', [draft(0, 'captured anyway')]);

    // The stored hash records the model the row is destined for, so an unchanged
    // source is recognised as unchanged even though it has no vector yet.
    const second = await broken.ingest('deliverable', 'src-1', [draft(0, 'captured anyway')]);
    expect(second).toMatchObject({ unchanged: 1, deferred: 0 });
  });
});

describe('sweepPendingEmbeddings', () => {
  it('embeds the backlog and makes it searchable', async () => {
    const brokenThenWorking: EmbeddingProviderPort = {
      id: provider.id,
      dimensions: provider.dimensions,
      init: async () => {},
      isReady: () => true,
      embedPassages: async () => { throw new Error('unavailable'); },
      embedQuery: async (t) => provider.embedQuery(t),
    };
    const deferring = new MemoryKernel(store, brokenThenWorking, silent as never);
    await deferring.ingest('deliverable', 'src-1', [draft(0, 'deferred alpha'), draft(1, 'deferred beta')]);
    expect((await store.getStats()).pendingEmbeddings).toBe(2);

    const embedded = await kernel.sweepPendingEmbeddings();

    expect(embedded).toBe(2);
    expect((await store.getStats()).pendingEmbeddings).toBe(0);
    const hits = await store.search(await provider.embedQuery('deferred alpha'), {}, 5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('discards a vector whose chunk changed while it was being computed', async () => {
    // The window is real: embedding a batch takes long enough for a comment to
    // land, and a vector written by id alone would describe text that is gone —
    // permanently, since the row would no longer look pending.
    const deferring = new MemoryKernel(store, {
      id: provider.id, dimensions: provider.dimensions,
      init: async () => {}, isReady: () => true,
      embedPassages: async () => { throw new Error('unavailable'); },
      embedQuery: async (t) => provider.embedQuery(t),
    }, silent as never);
    await deferring.ingest('deliverable', 'src-1', [draft(0, 'the original text')]);

    // A provider that mutates the source mid-embed, standing in for a concurrent
    // re-ingestion.
    const racing = new MemoryKernel(store, {
      id: provider.id, dimensions: provider.dimensions,
      init: async () => {}, isReady: () => true,
      embedPassages: async (texts) => {
        await deferring.ingest('deliverable', 'src-1', [draft(0, 'replaced before the write')]);
        return provider.embedPassages(texts);
      },
      embedQuery: async (t) => provider.embedQuery(t),
    }, silent as never);

    await racing.sweepPendingEmbeddings();

    // The vector was refused, so the row is still pending — with its new text.
    expect((await store.getStats()).pendingEmbeddings).toBe(1);
    const [row] = await store.listPendingEmbeddings(5);
    expect(row?.content).toBe('replaced before the write');

    // And the next pass embeds the text that is actually there.
    expect(await kernel.sweepPendingEmbeddings()).toBe(1);
    expect((await store.getStats()).pendingEmbeddings).toBe(0);
  });

  it('re-embeds rows left behind by a previous model', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'indexed by the old encoder')]);
    expect((await store.getStats(provider.id)).staleModelChunks).toBe(0);

    // Same corpus, different encoder — the situation after switching models in
    // Settings.
    const other = new FakeEmbeddingProvider(16);
    await other.init();
    const renamed: EmbeddingProviderPort = {
      id: 'fake:another-model',
      dimensions: other.dimensions,
      init: async () => {},
      isReady: () => true,
      embedPassages: (texts) => other.embedPassages(texts),
      embedQuery: (t) => other.embedQuery(t),
    };
    const migrating = new MemoryKernel(store, renamed, silent as never);

    expect((await store.getStats(renamed.id)).staleModelChunks).toBe(1);
    // No vector is missing, so the old sweep would have found nothing to do.
    expect((await store.getStats(renamed.id)).pendingEmbeddings).toBe(0);

    expect(await migrating.sweepPendingEmbeddings()).toBe(1);
    expect((await store.getStats(renamed.id)).staleModelChunks).toBe(0);
    expect((await store.getStats(renamed.id)).embeddingModels).toEqual([renamed.id]);
  });

  it('leaves a migrated chunk recognised as unchanged, so it is not re-embedded forever', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'stable text')]);
    const renamed: EmbeddingProviderPort = {
      id: 'fake:another-model', dimensions: provider.dimensions,
      init: async () => {}, isReady: () => true,
      embedPassages: (texts) => provider.embedPassages(texts),
      embedQuery: (t) => provider.embedQuery(t),
    };
    const migrating = new MemoryKernel(store, renamed, silent as never);
    await migrating.sweepPendingEmbeddings();

    // The hash covers the model id, so the sweep has to restate it — otherwise
    // every later event would see a mismatch and re-embed this chunk.
    const again = await migrating.ingest('deliverable', 'src-1', [draft(0, 'stable text')]);
    expect(again).toMatchObject({ unchanged: 1, embedded: 0 });
  });

  it('keeps a superseded model out of search results', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'session expiry rules')]);
    const query = await provider.embedQuery('session expiry rules');

    // Same vectors, but the caller declares a different active model: the row
    // must not be scored, because distances across models are meaningless.
    expect(await store.search(query, { embeddingModel: provider.id }, 5)).toHaveLength(1);
    expect(await store.search(query, { embeddingModel: 'fake:another-model' }, 5)).toHaveLength(0);
  });

  it('still finds a stale-model chunk by keyword, so nothing disappears mid-migration', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'ERR_CONN_RESET on deploy')]);
    const found = await store.searchKeyword('ERR_CONN_RESET', { embeddingModel: 'fake:another-model' }, 5);
    expect(found).toHaveLength(1);
  });

  it('reports zero when there is nothing pending, so a caller can stop looping', async () => {
    await kernel.ingest('deliverable', 'src-1', [draft(0, 'already embedded')]);
    expect(await kernel.sweepPendingEmbeddings()).toBe(0);
  });

  it('respects its batch limit', async () => {
    const deferring = new MemoryKernel(store, {
      id: provider.id, dimensions: provider.dimensions,
      init: async () => {}, isReady: () => true,
      embedPassages: async () => { throw new Error('unavailable'); },
      embedQuery: async (t) => provider.embedQuery(t),
    }, silent as never);
    await deferring.ingest('deliverable', 'src-1', [draft(0, 'a'), draft(1, 'b'), draft(2, 'c')]);

    expect(await kernel.sweepPendingEmbeddings(2)).toBe(2);
    expect(await kernel.sweepPendingEmbeddings(2)).toBe(1);
  });
});

describe('ingestion through the real chunker', () => {
  it('indexes a ticket and finds it by meaning', async () => {
    const drafts = chunkTicket({
      id: 't1', displayId: 42, title: 'Session tokens expire too early', status: 'done',
      description: 'Users are logged out after ten minutes instead of the configured hour.',
      boardId: 'b1', tags: ['auth'], repo: 'org/app', updatedAt: new Date('2026-08-01T00:00:00Z'),
    });

    await kernel.ingest('ticket', 't1', drafts);

    const hits = await store.search(await provider.embedQuery('logged out after ten minutes'), {}, 5);
    expect(hits[0]!.chunk.sourceId).toBe('t1');
    expect(hits[0]!.chunk.metadata).toMatchObject({ boardId: 'b1', repo: 'org/app', tags: ['auth'] });
  });
});
