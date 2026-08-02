import { describe, it, expect } from 'vitest';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

/**
 * The dead-letter gate in `runMention` — see `docs/execution-recovery-policy.md`.
 *
 * The budget is what turns "a crash no longer relaunches itself" into "a crash
 * cannot be relaunched forever either". A deterministic failure (bad prompt,
 * revoked credentials) would otherwise be one click away from an endless loop,
 * so past the ceiling the one-click relaunch is refused and only an explicit,
 * confirmed Force relaunch gets through.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeMention(id: string, agent = 'A', ticketId = 'T'): TicketMentionEntity {
  return TicketMentionEntity.create({
    id, ticketId, commentId: `c-${id}`, targetAgent: agent, sourceAgent: 'user', targetType: 'agent',
  });
}

function makeHarness(opts: { maxAttempts?: number } = {}) {
  const persona = { id: 'p1', name: 'A' } as never;
  const mentions = new Map<string, TicketMentionEntity>();

  const mentionStore = {
    getById: async (id: string) => mentions.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...mentions.values()].filter((m) => m.ticketId === ticketId),
    getPendingForAgent: async (name: string) =>
      [...mentions.values()].filter((m) => m.targetAgent === name && m.status === 'pending'),
    save: async (m: TicketMentionEntity) => { mentions.set(m.id, m); },
  } as never;

  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  const config = { get: () => ({ agentMaxAttempts: opts.maxAttempts ?? 3 }) } as never;
  const sdkLimiter = { run: (fn: () => Promise<unknown>) => fn() } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, mentionStore, stub, stub, stub, stub, stub, stub, stub, config, logger, stub, sdkLimiter, stub,
  );

  // Stand in for the SDK-driven dispatch: record what actually reached it and
  // charge the attempt exactly where the real one does.
  const dispatched: string[] = [];
  (useCase as unknown as { executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void> })
    .executeForMention = async (_p, mention) => {
      dispatched.push(mention.id);
      const live = mentions.get(mention.id)!;
      live.startAttempt();
      mentions.set(live.id, live);
    };

  return { useCase, mentions, dispatched };
}

/** A mention that already crashed `times` times. */
function failedAfter(id: string, times: number): TicketMentionEntity {
  const m = makeMention(id);
  for (let i = 0; i < times; i += 1) m.startAttempt();
  m.acknowledge();
  m.markFailed('subprocess', 'boom');
  return m;
}

describe('dead-letter gate on relaunch', () => {
  // WHY: below the ceiling nothing changes — a crash card must stay one click
  // away from a retry, which is the recovery path #443 shipped.
  it('relaunches a failed mention that still has budget left', async () => {
    const { useCase, mentions, dispatched } = makeHarness({ maxAttempts: 3 });
    const m = failedAfter('m1', 1);
    mentions.set('m1', m);

    const result = await useCase.runMention(m);
    await flush();

    expect(result.status).toBe('started');
    expect(dispatched).toEqual(['m1']);
  });

  // WHY: the ticket's second acceptance criterion — "after N relaunches it is no
  // longer automatically relaunchable". The gate must refuse BEFORE anything is
  // dispatched, otherwise the run happens and the budget is decorative.
  it('refuses a one-click relaunch once the budget is spent, without dispatching', async () => {
    const { useCase, mentions, dispatched } = makeHarness({ maxAttempts: 3 });
    const m = failedAfter('m1', 3);
    mentions.set('m1', m);

    const result = await useCase.runMention(m);
    await flush();

    expect(result.status).toBe('attempts_exhausted');
    expect(result.mentionIds).toEqual([]);
    expect(dispatched).toEqual([]);
    // Still failed: a refused relaunch must not park the mention back in the
    // pending queue, or the auto-trigger sweep would run it anyway.
    expect(mentions.get('m1')!.status).toBe('failed');
  });

  // WHY: we remove the *automatic* retry loop, never the user's ability to
  // insist. Force is the escape hatch, and it must grant a fresh budget —
  // otherwise the next crash would immediately re-lock the mention.
  it('lets a confirmed force relaunch through with a fresh budget', async () => {
    const { useCase, mentions, dispatched } = makeHarness({ maxAttempts: 3 });
    const m = failedAfter('m1', 3);
    mentions.set('m1', m);

    const result = await useCase.runMention(m, { force: true });
    await flush();

    expect(result.status).toBe('started');
    expect(dispatched).toEqual(['m1']);
    // Reset to 0 by the force, then charged once by the dispatch.
    expect(mentions.get('m1')!.attemptCount).toBe(1);
  });

  // WHY: the card renders the persisted cause. Leaving the old one in place
  // would keep showing "Usage limit reached" on a mention that is running again.
  it('clears the stale failure cause when the mention is relaunched', async () => {
    const { useCase, mentions } = makeHarness({ maxAttempts: 3 });
    const m = failedAfter('m1', 1);
    mentions.set('m1', m);

    await useCase.runMention(m);
    await flush();

    expect(mentions.get('m1')!.failureReason).toBeNull();
    expect(mentions.get('m1')!.failureDetail).toBeNull();
  });

  // WHY: a misconfigured ceiling must never freeze an instance — `0` means "no
  // cap" rather than "nothing may ever run".
  it('never dead-letters when the ceiling is disabled', async () => {
    const { useCase, mentions, dispatched } = makeHarness({ maxAttempts: 0 });
    const m = failedAfter('m1', 99);
    mentions.set('m1', m);

    const result = await useCase.runMention(m);
    await flush();

    expect(result.status).toBe('started');
    expect(dispatched).toEqual(['m1']);
  });
});

describe('dispatch guard rail', () => {
  // WHY: `runMention` is the front door, but the queue can also be fed by
  // `execute()`. If a dead-lettered mention ever reaches the dispatcher, that is
  // a hole in the policy — refuse it there too rather than let the crash loop
  // the budget exists to break run one more time.
  it('refuses to dispatch a queued mention that already exhausted its budget', async () => {
    const { useCase, mentions, dispatched } = makeHarness({ maxAttempts: 3 });
    const m = makeMention('m1');
    for (let i = 0; i < 3; i += 1) m.startAttempt();
    mentions.set('m1', m); // left `pending` — the state that should be unreachable

    await useCase.execute('p1');
    await flush();

    expect(dispatched).toEqual([]);
    expect(mentions.get('m1')!.status).toBe('failed');
  });
});
