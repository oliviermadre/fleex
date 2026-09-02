/**
 * Integration tests — backfill
 *
 * Covers the two jobs a full walk has that the event listener does not: indexing
 * content that existed before the engine was switched on, and removing indexed
 * sources that no longer exist.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteMemoryStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-memory-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { MemoryKernel } from '../../src/application/memory/memory-kernel.js';
import { BackfillMemoryUseCase } from '../../src/application/use-cases/backfill-memory.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';
import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { SkillStorePort } from '../../src/application/ports/skill-store.port.js';
import type { TicketGroupStorePort } from '../../src/application/ports/ticket-group-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteMemoryStoreAdapter;
let kernel: MemoryKernel;
let provider: FakeEmbeddingProvider;

/** Mutable fixtures, so a second run can walk a smaller corpus. */
let tickets: Array<{
  id: string; displayId: number; title: string; description: string; status: string;
  boardId: string; tags: string[]; links: Array<{ type: string; ref: string }>; updatedAt: Date;
}>;
let notes: Array<{ key: string; value: string }>;

function ticket(id: string, displayId: number, title: string, description: string) {
  return {
    id, displayId, title, description, status: 'done', boardId: 'b1', tags: ['auth'],
    links: [{ type: 'repository', ref: 'org/app' }], updatedAt: new Date('2026-08-01T00:00:00Z'),
  };
}

function backfill(): BackfillMemoryUseCase {
  return new BackfillMemoryUseCase(
    kernel,
    { getAllTickets: async () => tickets } as unknown as TicketStorePort,
    { getByTicket: async () => [] } as unknown as CommentStorePort,
    { getAll: async () => [] } as unknown as DeliverableStorePort,
    { getAll: async () => [] } as unknown as PersonaStorePort,
    { getAll: async () => [] } as unknown as SkillStorePort,
    silent as never,
    { getAllTicketGroups: async () => [] } as unknown as TicketGroupStorePort,
    { listByPrefix: async () => notes } as unknown as KvStorePort,
  );
}

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteMemoryStoreAdapter(conn);
  provider = new FakeEmbeddingProvider();
  await provider.init();
  kernel = new MemoryKernel(store, provider, silent as never);

  tickets = [
    ticket('t1', 1, 'Session tokens expire early', 'The refresh token was never rotated.'),
    ticket('t2', 2, 'Deploy pipeline is slow', 'The docker layer cache key includes a timestamp.'),
  ];
  notes = [
    { key: 'scratchpad:__global__', value: '# Conventions\n\nNever modify a committed migration.' },
    { key: 'scratchpad:org/app', value: '# org/app\n\nRow level security on every new table.' },
  ];
});

afterEach(() => {
  conn.close();
});

describe('walking what already exists', () => {
  it('indexes tickets that predate the engine being switched on', async () => {
    const progress = await backfill().execute();
    expect(progress.tickets).toBe(2);

    const hits = await store.searchKeyword('refresh token', { kinds: ['ticket'] }, 5);
    expect(hits).toHaveLength(1);
  });

  it('indexes notes, which the event listener only ever sees on the next edit', async () => {
    const progress = await backfill().execute();
    expect(progress.notes).toBe(2);

    const hits = await store.searchKeyword('Row level security', { kinds: ['scratchpad'] }, 5);
    expect(hits).toHaveLength(1);
    // The global note is labelled, not shown by its raw key.
    const global = await store.searchKeyword('committed migration', { kinds: ['scratchpad'] }, 5);
    expect(global[0]?.title).toContain('Global');
  });

  it('is a no-op when re-run, so it can be a button rather than a migration', async () => {
    await backfill().execute();
    provider.resetEmbedCallCount();

    const second = await backfill().execute();
    expect(second.chunksUnchanged).toBeGreaterThan(0);
    expect(second.chunksEmbedded).toBe(0);
    expect(provider.getEmbedCallCount()).toBe(0);
  });
});

describe('pruning what no longer exists', () => {
  it('drops a ticket deleted while nothing was listening', async () => {
    await backfill().execute();
    expect((await store.getStats()).totalChunks).toBeGreaterThan(2);

    // Deleted directly in the store — no event, which is what happens when the
    // deletion lands while the server is down.
    tickets = tickets.filter((t) => t.id !== 't2');
    const progress = await backfill().execute();

    expect(progress.pruned).toBeGreaterThan(0);
    expect(await store.searchKeyword('docker layer cache', {}, 5)).toHaveLength(0);
    // And the surviving ticket is untouched.
    expect(await store.searchKeyword('refresh token', {}, 5)).toHaveLength(1);
  });

  it('drops a note that was deleted', async () => {
    await backfill().execute();
    notes = notes.filter((n) => n.key !== 'scratchpad:org/app');

    await backfill().execute();
    expect(await store.searchKeyword('Row level security', {}, 5)).toHaveLength(0);
  });

  it('never prunes a kind nothing walks', async () => {
    // A distilled run trace has no live source to compare against; treating it as
    // orphaned would delete exactly the memory the feature exists to keep.
    await kernel.ingest('execution_trace', 'exec-1', [{
      sourceKind: 'execution_trace', sourceId: 'exec-1', chunkIndex: 0,
      title: 'What the run learned', content: 'The arm runner has no docker.',
      metadata: {}, sourceUpdatedAt: new Date(),
    }]);

    await backfill().execute();
    expect(await store.searchKeyword('arm runner', {}, 5)).toHaveLength(1);
  });

  it('prunes nothing when a store read comes back empty', async () => {
    await backfill().execute();
    const before = (await store.getStats()).totalChunks;

    // An empty walk is indistinguishable from an unreadable store, so the pruner
    // has to stand down rather than delete the index.
    tickets = [];
    notes = [];
    const progress = await backfill().execute();

    expect(progress.pruned).toBe(0);
    expect((await store.getStats()).totalChunks).toBe(before);
  });
});
