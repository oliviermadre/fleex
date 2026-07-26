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
