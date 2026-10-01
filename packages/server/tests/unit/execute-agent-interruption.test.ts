import { describe, it, expect } from 'vitest';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeMention(id: string, status: TicketMentionEntity['status'] = 'acknowledged'): TicketMentionEntity {
  const m = TicketMentionEntity.create({
    id, ticketId: 'T', commentId: `c-${id}`, targetAgent: 'A', sourceAgent: 'user', targetType: 'agent',
  });
  m.status = status;
  return m;
}

/**
 * A run that stops before `completed` (Terminate, timeout, server restart) must
 * leave its mention `failed` — never `pending`, which nothing would pick up again
 * (the queue only fills on new mentions, wake-ups and startup): Focus showed such
 * a mention as "en file" forever. `failed` surfaces it as an error with Relancer.
 */
function makeUseCase(interrupted: string[] = []) {
  const persona = { id: 'p1', name: 'A' } as never;
  const mentions = new Map<string, TicketMentionEntity>();
  const mentionStore = {
    getById: async (id: string) => mentions.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...mentions.values()].filter((m) => m.ticketId === ticketId),
    getPendingForAgent: async () => [],
    save: async (m: TicketMentionEntity) => { mentions.set(m.id, m); },
  } as never;
  const agentEventStore = {
    appendEvent: async () => {},
    completeExecution: async () => {},
    markInterruptedExecutions: async () => interrupted,
    getSessionHistory: async () => new Map(),
  } as never;
  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  const sdkLimiter = { run: (fn: () => Promise<unknown>) => fn() } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, mentionStore, stub, stub, stub, stub, agentEventStore, stub, stub, stub, logger, stub, sdkLimiter, stub,
  );
  const events: Array<{ type: string; mentionId?: string; reason?: string }> = [];
  useCase.eventBus = { emit: (e: never) => { events.push(e); } } as never;

  const dispatched: string[] = [];
  (useCase as unknown as { executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void> })
    .executeForMention = async (_persona, mention) => { dispatched.push(mention.id); };

  const track = (mentionId: string, executionId: string) =>
    (useCase as unknown as { activeExecutions: Map<string, unknown> }).activeExecutions.set(mentionId, {
      mentionId, executionId, personaId: 'p1', ticketId: 'T', status: 'running', abortController: new AbortController(),
    });

  return { useCase, mentions, events, dispatched, track };
}

describe('ExecuteAgentUseCase — interrupted runs end failed', () => {
  it('Terminate leaves the mention failed, with a cancelled reason', async () => {
    const { useCase, mentions, events, track } = makeUseCase();
    mentions.set('m1', makeMention('m1'));
    track('m1', 'x1');

    expect(await useCase.cancelExecution('x1')).toBe(true);

    expect(mentions.get('m1')!.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'mention.execution_failed', mentionId: 'm1', reason: 'cancelled' }));
  });

  it('a server restart leaves the orphaned mention failed instead of re-running it', async () => {
    const { useCase, mentions, events, dispatched } = makeUseCase(['m1']);
    mentions.set('m1', makeMention('m1'));

    await useCase.init();
    await flush();

    expect(mentions.get('m1')!.status).toBe('failed');
    expect(dispatched).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'mention.execution_failed', mentionId: 'm1', reason: 'server_restart' }));
  });

  it('Relancer picks an interrupted mention back up', async () => {
    const { useCase, mentions, dispatched, track } = makeUseCase();
    mentions.set('m1', makeMention('m1'));
    track('m1', 'x1');
    await useCase.cancelExecution('x1');

    await useCase.runMention(mentions.get('m1')!);
    await flush();

    expect(dispatched).toEqual(['m1']);
  });
});
