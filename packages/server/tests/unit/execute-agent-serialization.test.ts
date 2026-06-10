import { describe, it, expect } from 'vitest';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

// Flush microtasks + one macrotask tick so the async drain loop, the dispatch
// `.finally` re-drain, and the stubbed executeForMention all settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeMention(id: string, ticketId = 'T', agent = 'A'): TicketMentionEntity {
  return TicketMentionEntity.create({
    id, ticketId, commentId: `c-${id}`, targetAgent: agent, sourceAgent: 'user', targetType: 'agent',
  });
}

/**
 * Build an ExecuteAgentUseCase wired with minimal in-memory fakes and a stubbed
 * `executeForMention` (the real one drives the Claude SDK). The stub records
 * dispatch order and applies a scripted outcome ('waiting' | 'resolved'), so we
 * can assert the scheduler's serialization gate and dedup in isolation.
 */
function makeUseCase() {
  const persona = { id: 'p1', name: 'A' } as never;
  const mentions = new Map<string, TicketMentionEntity>();

  const mentionStore = {
    getById: async (id: string) => mentions.get(id) ?? null,
    getByTicket: async (ticketId: string) =>
      [...mentions.values()].filter((m) => m.ticketId === ticketId),
    getPendingForAgent: async (name: string) =>
      [...mentions.values()].filter((m) => m.targetAgent === name && m.status === 'pending'),
    save: async (m: TicketMentionEntity) => { mentions.set(m.id, m); },
  } as never;

  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  const sdkLimiter = { run: (fn: () => Promise<unknown>) => fn() } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, mentionStore, stub, stub, stub, stub, stub, stub, stub, stub, logger, stub, sdkLimiter, stub,
  );

  const dispatched: string[] = [];
  const outcomes = new Map<string, 'waiting' | 'resolved'>();
  const gates = new Map<string, { promise: Promise<void>; resolve: () => void }>();

  // Replace the SDK-driven method with a deterministic stub.
  (useCase as unknown as { executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void> })
    .executeForMention = async (_persona, mention) => {
      dispatched.push(mention.id);
      const gate = gates.get(mention.id);
      if (gate) await gate.promise; // lets a test hold a run "in flight" (mention stays pending)
      const m = mentions.get(mention.id)!;
      m.status = outcomes.get(mention.id) === 'waiting' ? 'waiting_for_info' : 'resolved';
      mentions.set(m.id, m);
    };

  return { useCase, mentions, dispatched, outcomes, gates };
}

describe('ExecuteAgentUseCase — per-(agent,ticket) serialization', () => {
  it('keeps a queued sibling blocked while a mention is waiting_for_info, runs it after resolve', async () => {
    const { useCase, mentions, dispatched, outcomes } = makeUseCase();
    const m1 = makeMention('m1');
    const m2 = makeMention('m2');
    mentions.set('m1', m1);
    mentions.set('m2', m2);
    outcomes.set('m1', 'waiting');   // m1 parks in waiting_for_info
    outcomes.set('m2', 'resolved');

    await useCase.execute('p1');
    await flush();

    // m1 ran and is waiting; m2 must NOT have started (lane held by waiting m1).
    expect(dispatched).toEqual(['m1']);
    expect(mentions.get('m1')!.status).toBe('waiting_for_info');
    expect(mentions.get('m2')!.status).toBe('pending');

    // Simulate an external (manual UI) resolve of the waiting mention.
    const fresh = mentions.get('m1')!;
    fresh.resolve();
    mentions.set('m1', fresh);
    // The bus subscription would call drainQueue on `mention.resolved`; invoke it directly.
    (useCase as unknown as { drainQueue: () => void }).drainQueue();
    await flush();

    // Now the sibling runs.
    expect(dispatched).toEqual(['m1', 'm2']);
    expect(mentions.get('m2')!.status).toBe('resolved');
  });

  it('does not double-dispatch the same mention across concurrent execute() calls', async () => {
    const { useCase, mentions, dispatched, outcomes, gates } = makeUseCase();
    const m1 = makeMention('m1');
    mentions.set('m1', m1);
    outcomes.set('m1', 'resolved');
    gates.set('m1', deferred()); // hold m1 in flight so it stays `pending` + claimed

    await useCase.execute('p1');
    await flush();
    expect(dispatched).toEqual(['m1']);
    expect(mentions.get('m1')!.status).toBe('pending'); // held at the gate

    // A second trigger while m1 is still claimed must NOT re-enqueue it.
    await useCase.execute('p1');
    await flush();
    expect(dispatched).toEqual(['m1']);

    // Release the in-flight run; it resolves cleanly.
    gates.get('m1')!.resolve();
    await flush();
    expect(mentions.get('m1')!.status).toBe('resolved');
  });

  it('runs independent tickets in parallel (lane is per agent+ticket)', async () => {
    const { useCase, mentions, dispatched, outcomes, gates } = makeUseCase();
    const a = makeMention('a', 'T1');
    const b = makeMention('b', 'T2');
    mentions.set('a', a);
    mentions.set('b', b);
    outcomes.set('a', 'resolved');
    outcomes.set('b', 'resolved');
    gates.set('a', deferred()); // hold both in flight simultaneously
    gates.set('b', deferred());

    await useCase.execute('p1');
    await flush();

    // Both tickets dispatched concurrently — different worktrees, no blocking.
    expect(dispatched.sort()).toEqual(['a', 'b']);

    gates.get('a')!.resolve();
    gates.get('b')!.resolve();
    await flush();
  });
});
