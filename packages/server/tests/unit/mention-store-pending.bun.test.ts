import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteMentionStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-mention-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function mention(id: string, agent: string): TicketMentionEntity {
  return TicketMentionEntity.create({
    id,
    ticketId: `t-${id}`,
    commentId: `c-${id}`,
    targetAgent: agent,
    sourceAgent: 'user',
  });
}

let conn: SqliteConnection;
let store: SqliteMentionStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteMentionStoreAdapter(conn);
});

afterEach(() => {
  conn.close();
});

describe('SqliteMentionStore.getPendingForAgent', () => {
  // WHY: getPendingForAgent feeds the persona-scoped auto-trigger
  // (handleAutoTriggerAgent → execute()). A `failed` mention must be excluded
  // exactly like `resolved`/`waiting_for_info`, otherwise creating any new mention
  // for the same agent would silently re-run a crashed one — auto-retry on an
  // unresolved cause, which is the explicit non-goal of ticket #443. A crashed
  // mention is only ever relaunched by the user via the crash card (runMention).
  it('excludes failed mentions so the auto-trigger never re-runs a crashed one', async () => {
    const pending = mention('pending', 'builder');

    const acknowledged = mention('ack', 'builder');
    acknowledged.acknowledge();

    const waiting = mention('waiting', 'builder');
    waiting.acknowledge();
    waiting.waitForInfo();

    const resolved = mention('resolved', 'builder');
    resolved.acknowledge();
    resolved.resolve();

    const failed = mention('failed', 'builder');
    failed.acknowledge();
    failed.markFailed();
    expect(failed.status).toBe('failed');

    for (const m of [pending, acknowledged, waiting, resolved, failed]) {
      await store.save(m);
    }

    const result = await store.getPendingForAgent('builder');
    const ids = result.map((m) => m.id).sort();

    // pending + acknowledged are dispatchable; failed/resolved/waiting are not.
    expect(ids).toEqual(['ack', 'pending']);
    expect(ids).not.toContain('failed');
  });
});
