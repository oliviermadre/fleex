import { describe, it, expect } from 'vitest';
import { JsonMentionStore } from '../../src/infrastructure/adapters/json-mention-store.adapter.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { HostFs } from '../../src/infrastructure/host/types.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

// In-memory HostFs: getPendingForAgent never touches disk, and save() only needs
// writeFile to be a no-op, so a minimal stub is enough to exercise the real query.
const fakeFs = {
  exists: async () => false,
  readFile: async () => '[]',
  writeFile: async () => {},
} as unknown as HostFs;

/** HostFs backed by a single in-memory file, to exercise the real round-trip. */
function diskFs(): HostFs {
  let content: string | null = null;
  return {
    exists: async () => content !== null,
    readFile: async () => content ?? '[]',
    writeFile: async (_path: string, data: string) => { content = data; },
  } as unknown as HostFs;
}

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as LoggerPort;

function mention(id: string, agent: string): TicketMentionEntity {
  return TicketMentionEntity.create({
    id,
    ticketId: `t-${id}`,
    commentId: `c-${id}`,
    targetAgent: agent,
    sourceAgent: 'user',
  });
}

describe('JsonMentionStore.getPendingForAgent', () => {
  // WHY: getPendingForAgent feeds the persona-scoped auto-trigger
  // (handleAutoTriggerAgent → execute()). A `failed` mention must be excluded
  // exactly like `resolved`/`waiting_for_info`, otherwise creating any new mention
  // for the same agent would silently re-run a crashed one — auto-retry on an
  // unresolved cause, which is the explicit non-goal of ticket #443. A crashed
  // mention is only ever relaunched by the user via the crash card (runMention).
  it('excludes failed mentions so the auto-trigger never re-runs a crashed one', async () => {
    const store = new JsonMentionStore(fakeFs, '/tmp', logger);
    await store.init();

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
    failed.markFailed('timeout');
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

describe('JsonMentionStore — attempt budget & failure cause persistence', () => {
  // WHY: the whole point of persisting the cause is that it survives a restart.
  // If the JSON store drops these fields, the crash card falls back to generic
  // copy on reload and the attempt budget silently resets to 0 — meaning a
  // crash loop could never be dead-lettered on the json backend.
  it('round-trips the attempt count and the failure cause across a reload', async () => {
    const fs = diskFs();
    const store = new JsonMentionStore(fs, '/tmp', logger);
    await store.init();

    const m = mention('crashed', 'builder');
    m.startAttempt();
    m.startAttempt();
    m.acknowledge();
    m.markFailed('usage_limit', 'org monthly limit reached');
    await store.save(m);

    // Simulate a server restart: a brand-new store reading the same file.
    const reloaded = new JsonMentionStore(fs, '/tmp', logger);
    await reloaded.init();
    const found = await reloaded.getById('crashed');

    expect(found).not.toBeNull();
    expect(found!.attemptCount).toBe(2);
    expect(found!.failureReason).toBe('usage_limit');
    expect(found!.failureDetail).toBe('org monthly limit reached');
  });

  // WHY: mentions written before migration 025 have no attempt data. They must
  // read as a fresh budget (0) rather than NaN/undefined, which would make
  // isExhausted() throw the user into a dead letter they can't explain.
  it('reads a pre-migration mention as a fresh budget with no failure cause', async () => {
    const legacy = JSON.stringify([{
      id: 'legacy', ticketId: 't', commentId: 'c',
      targetAgent: 'builder', sourceAgent: 'user',
      targetType: 'agent', executionMode: 'edit', status: 'failed',
      resolvedAt: null, resolvedCommentId: null, resolvedDeliverableId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    const fs = {
      exists: async () => true,
      readFile: async () => legacy,
      writeFile: async () => {},
    } as unknown as HostFs;

    const store = new JsonMentionStore(fs, '/tmp', logger);
    await store.init();
    const found = await store.getById('legacy');

    expect(found!.attemptCount).toBe(0);
    expect(found!.failureReason).toBeNull();
    expect(found!.isExhausted(3)).toBe(false);
  });
});
