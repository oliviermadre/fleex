/**
 * Integration tests — event-driven memory ingestion
 *
 * Runs against the real SQLite store so the assertions are about what ends up
 * indexed, not about which mock was called: that a burst of edits produces one
 * re-index of the final text, that the default engine queues nothing, and that
 * metadata-only changes are picked up without re-embedding.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteMemoryStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-memory-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { MemoryKernel } from '../../src/application/memory/memory-kernel.js';
import { MemoryEventListener } from '../../src/application/memory/memory-event-listener.js';
import { EventBus } from '../../src/application/event-bus.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { SkillStorePort } from '../../src/application/ports/skill-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteMemoryStoreAdapter;
let provider: FakeEmbeddingProvider;
let kernel: MemoryKernel;
let bus: EventBus;
let listener: MemoryEventListener;
let engine: 'legacy' | 'semantic';

/** Mutable fixture state the fake stores read, so an event can observe an edit. */
let ticket: {
  id: string; displayId: number; title: string; description: string; status: string;
  boardId: string; tags: string[]; links: Array<{ type: string; ref: string }>; updatedAt: Date;
};
let comments: Array<{ id: string; authorName: string; authorType: string; body: string; visibility: string; createdAt: Date }>;
let scratchpadContent: string;

function makeConfig(): ConfigPort {
  return {
    init: async () => {},
    get: () => ({ basePath: '/tmp', defaultShell: 'bash', repositoryRefreshIntervalMs: 0, memoryEngine: engine } as AppConfig),
    update: () => {},
    getClaudeCommand: () => 'claude',
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  engine = 'semantic';
  ticket = {
    id: 't1', displayId: 42, title: 'Session tokens expire early',
    description: 'Users are logged out after ten minutes.',
    status: 'doing', boardId: 'b1', tags: ['auth'],
    links: [{ type: 'repository', ref: 'org/app' }],
    updatedAt: new Date('2026-08-01T00:00:00Z'),
  };
  comments = [];
  scratchpadContent = 'remember the migration order before deploying';

  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteMemoryStoreAdapter(conn);
  provider = new FakeEmbeddingProvider();
  await provider.init();
  kernel = new MemoryKernel(store, provider, silent as never);
  bus = new EventBus();

  listener = new MemoryEventListener({
    bus,
    kernel,
    config: makeConfig(),
    ticketStore: { getTicketById: async (id: string) => (id === ticket.id ? ticket : null) } as unknown as TicketStorePort,
    commentStore: { getByTicket: async () => comments } as unknown as CommentStorePort,
    deliverableStore: { getById: async () => null } as unknown as DeliverableStorePort,
    personaStore: { getById: async () => null } as unknown as PersonaStorePort,
    skillStore: { getById: async () => null } as unknown as SkillStorePort,
    kvStore: { get: async () => scratchpadContent } as unknown as KvStorePort,
    logger: silent as never,
  });
  listener.register();
});

afterEach(() => {
  listener.stop();
  vi.useRealTimers();
  conn.close();
});

/** Advance past the debounce and let the queued promises settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2_500);
  await vi.runAllTimersAsync();
}

function emitTicketUpdated(): void {
  bus.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: {}, occurredAt: new Date() } as never);
}

describe('the default engine costs nothing', () => {
  it('queues no work when memoryEngine is legacy', async () => {
    engine = 'legacy';
    emitTicketUpdated();
    await settle();

    // Not merely "no embeddings" — nothing is written at all.
    expect((await store.getStats()).totalChunks).toBe(0);
    expect(provider.getEmbedCallCount()).toBe(0);
  });
});

describe('debouncing coalesces a burst', () => {
  it('indexes once for many edits, using the final text', async () => {
    emitTicketUpdated();
    ticket.description = 'Users are logged out after five minutes.';
    emitTicketUpdated();
    ticket.description = 'Users are logged out after two minutes.';
    emitTicketUpdated();

    await settle();

    // One pass over the final text, not three over intermediate states.
    const found = await store.searchKeyword('two minutes', {}, 5);
    expect(found).toHaveLength(1);
    expect(await store.searchKeyword('ten minutes', {}, 5)).toHaveLength(0);
    expect(await store.searchKeyword('five minutes', {}, 5)).toHaveLength(0);
  });

  it('does not index before the debounce elapses', async () => {
    emitTicketUpdated();
    await vi.advanceTimersByTimeAsync(500);
    expect((await store.getStats()).totalChunks).toBe(0);
  });
});

describe('ticket ingestion', () => {
  it('indexes the ticket and makes it retrievable', async () => {
    bus.emit({ type: 'ticket.created', ticketId: ticket.id, boardId: 'b1', occurredAt: new Date() } as never);
    await settle();

    const hits = await store.search(await provider.embedQuery('logged out after ten minutes'), {}, 5);
    expect(hits[0]?.chunk.sourceId).toBe('t1');
    expect(hits[0]?.chunk.metadata).toMatchObject({ boardId: 'b1', repo: 'org/app', tags: ['auth'] });
  });

  it('purges the ticket and its discussion on delete', async () => {
    comments = [{ id: 'c1', authorName: 'Olivier', authorType: 'user', body: 'still broken', visibility: 'public', createdAt: new Date() }];
    emitTicketUpdated();
    await settle();
    expect((await store.getStats()).totalChunks).toBeGreaterThan(1);

    bus.emit({ type: 'ticket.deleted', ticketId: ticket.id, occurredAt: new Date() } as never);
    await settle();
    expect((await store.getStats()).totalChunks).toBe(0);
  });

  it('survives a ticket deleted between the event and the drain', async () => {
    emitTicketUpdated();
    const missing = ticket.id;
    ticket = { ...ticket, id: 'gone' };
    await settle();

    // The re-fetch returns nothing; the handler must not throw.
    expect((await store.getStats()).totalChunks).toBe(0);
    expect(missing).toBe('t1');
  });
});

describe('comment thread ingestion', () => {
  it('indexes the public thread as one source', async () => {
    comments = [
      { id: 'c1', authorName: 'Olivier', authorType: 'user', body: 'what about option two?', visibility: 'public', createdAt: new Date() },
      { id: 'c2', authorName: 'Builder', authorType: 'agent', body: 'agreed, doing that', visibility: 'public', createdAt: new Date() },
    ];
    bus.emit({ type: 'comment.posted', commentId: 'c2', ticketId: ticket.id, authorType: 'agent', authorName: 'Builder', createdMentions: [], occurredAt: new Date() } as never);
    await settle();

    const threads = await store.searchKeyword('option two', { kinds: ['comment_thread'] }, 5);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.sourceId).toBe('t1');
  });

  it('never indexes a private comment', async () => {
    comments = [
      { id: 'c1', authorName: 'Olivier', authorType: 'user', body: 'public question', visibility: 'public', createdAt: new Date() },
      { id: 'c2', authorName: 'Olivier', authorType: 'user', body: 'secret aside for one agent', visibility: 'private', createdAt: new Date() },
    ];
    bus.emit({ type: 'comment.posted', commentId: 'c2', ticketId: ticket.id, authorType: 'user', authorName: 'Olivier', createdMentions: [], occurredAt: new Date() } as never);
    await settle();

    // A private comment is addressed to named agents; retrieving it into another
    // agent's context would leak it.
    expect(await store.searchKeyword('secret aside', {}, 5)).toHaveLength(0);
    expect(await store.searchKeyword('public question', {}, 5)).toHaveLength(1);
  });

  it('re-chunks the thread when a comment is deleted', async () => {
    comments = [{ id: 'c1', authorName: 'A', authorType: 'user', body: 'will be removed', visibility: 'public', createdAt: new Date() }];
    bus.emit({ type: 'comment.posted', commentId: 'c1', ticketId: ticket.id, authorType: 'user', authorName: 'A', createdMentions: [], occurredAt: new Date() } as never);
    await settle();
    expect(await store.searchKeyword('will be removed', {}, 5)).toHaveLength(1);

    comments = [];
    bus.emit({ type: 'comment.deleted', commentId: 'c1', ticketId: ticket.id, occurredAt: new Date() } as never);
    await settle();
    expect(await store.searchKeyword('will be removed', {}, 5)).toHaveLength(0);
  });
});

describe('metadata-only changes', () => {
  it('refreshes tags on unchanged chunks without re-embedding them', async () => {
    comments = [{ id: 'c1', authorName: 'A', authorType: 'user', body: 'a durable discussion', visibility: 'public', createdAt: new Date() }];
    emitTicketUpdated();
    await settle();

    const before = await store.search(await provider.embedQuery('a durable discussion'), {}, 5);
    expect(before[0]?.chunk.metadata.tags).toEqual(['auth']);

    // Retagging changes how the chunks should score but not one word of them, so
    // the content hash matches and the diff skips them — their metadata must
    // still be brought up to date.
    provider.resetEmbedCallCount();
    ticket.tags = ['auth', 'security'];
    bus.emit({ type: 'ticket.tagsChanged', ticketId: ticket.id, added: ['security'], removed: [], occurredAt: new Date() } as never);
    await settle();

    const after = await store.search(await provider.embedQuery('a durable discussion'), {}, 5);
    expect(after[0]?.chunk.metadata.tags).toEqual(['auth', 'security']);
    // Re-embedding identical text would be pure waste.
    expect(provider.getEmbedCallCount()).toBe(0);
  });

  it('refreshes the repo when one is linked later', async () => {
    emitTicketUpdated();
    await settle();

    ticket.links = [{ type: 'repository', ref: 'org/other' }];
    emitTicketUpdated();
    await settle();

    const hits = await store.search(await provider.embedQuery('logged out after ten minutes'), { repo: 'org/other' }, 5);
    expect(hits).toHaveLength(1);
  });
});

describe('scratchpad ingestion', () => {
  it('indexes a per-repo note with its repo attached', async () => {
    bus.emit({ type: 'scratchpad.updated', key: 'org/app', repo: 'org/app', occurredAt: new Date() } as never);
    await settle();

    const hits = await store.search(await provider.embedQuery('remember the migration order'), { repo: 'org/app' }, 5);
    expect(hits[0]?.chunk.sourceKind).toBe('scratchpad');
    expect(hits[0]?.chunk.metadata.repo).toBe('org/app');
  });

  it('labels the global note rather than showing its raw key', async () => {
    bus.emit({ type: 'scratchpad.updated', key: '__global__', repo: null, occurredAt: new Date() } as never);
    await settle();

    const found = await store.searchKeyword('migration order', { kinds: ['scratchpad'] }, 5);
    expect(found[0]?.title).toBe('Scratchpad: Global');
  });

  it('drops the note from the index when it is emptied', async () => {
    bus.emit({ type: 'scratchpad.updated', key: 'org/app', repo: 'org/app', occurredAt: new Date() } as never);
    await settle();
    expect((await store.getStats()).totalChunks).toBe(1);

    scratchpadContent = '';
    bus.emit({ type: 'scratchpad.updated', key: 'org/app', repo: 'org/app', occurredAt: new Date() } as never);
    await settle();
    // An emptied note must stop answering queries, not linger as a stale chunk.
    expect((await store.getStats()).totalChunks).toBe(0);
  });
});

describe('shutdown', () => {
  it('cancels queued work so timers cannot outlive the process', async () => {
    emitTicketUpdated();
    listener.stop();
    await settle();

    expect((await store.getStats()).totalChunks).toBe(0);
  });
});
