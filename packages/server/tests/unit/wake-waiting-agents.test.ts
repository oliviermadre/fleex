import { describe, it, expect } from 'vitest';
import { WakeWaitingAgentsUseCase } from '../../src/application/use-cases/wake-waiting-agents.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

function waitingMention(id: string, agent: string): TicketMentionEntity {
  const m = TicketMentionEntity.create({
    id, ticketId: 'T', commentId: `c-${id}`, targetAgent: agent, sourceAgent: 'user', targetType: 'agent',
  });
  m.status = 'waiting_for_info';
  return m;
}

function makeUseCase(waiting: TicketMentionEntity[], threadOf: Record<string, string> = {}) {
  const woken: string[] = [];
  const mentionStore = { getWaitingByTicket: async () => waiting } as never;
  const executeAgent = { wakeUp: async (m: TicketMentionEntity) => { woken.push(m.targetAgent); } } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  // `c-<mentionId>` → the comment that created the mention, in a thread or not.
  const commentStore = { getById: async (id: string) => ({ threadId: threadOf[id.replace(/^c-/, '')] ?? null }) } as never;
  return { useCase: new WakeWaitingAgentsUseCase(mentionStore, executeAgent, logger, commentStore), woken };
}

describe('WakeWaitingAgentsUseCase — exclusion', () => {
  it('wakes every waiting agent when nothing is excluded', async () => {
    const { useCase, woken } = makeUseCase([waitingMention('m1', 'A'), waitingMention('m2', 'B')]);
    await useCase.execute('T', []);
    expect(woken.sort()).toEqual(['A', 'B']);
  });

  it('does NOT wake an agent that was freshly re-mentioned by the same comment', async () => {
    // A re-mention of A is a new queued request, not an answer to A's pending
    // question — so A's waiting thread must stay parked while B still wakes.
    const { useCase, woken } = makeUseCase([waitingMention('m1', 'A'), waitingMention('m2', 'B')]);
    await useCase.execute('T', ['A']);
    expect(woken).toEqual(['B']);
  });

  it('excludes multiple agents (author + freshly mentioned)', async () => {
    const { useCase, woken } = makeUseCase([
      waitingMention('m1', 'A'), waitingMention('m2', 'B'), waitingMention('m3', 'C'),
    ]);
    await useCase.execute('T', ['A', 'C']);
    expect(woken).toEqual(['B']);
  });
});

describe('WakeWaitingAgentsUseCase — assistant thread scope', () => {
  it('a main-stream comment wakes main-stream agents only; agents parked in a thread stay parked', async () => {
    // The user's message goes to the assistant, who relays to its thread agents itself.
    const { useCase, woken } = makeUseCase([waitingMention('m1', 'A'), waitingMention('m2', 'B')], { m2: 'th1' });
    await useCase.execute('T', [], { threadId: null });
    expect(woken).toEqual(['A']);
  });

  it('no scope given behaves as the main stream (deliverable created, legacy callers)', async () => {
    const { useCase, woken } = makeUseCase([waitingMention('m1', 'A'), waitingMention('m2', 'B')], { m2: 'th1' });
    await useCase.execute('T');
    expect(woken).toEqual(['A']);
  });

  it('a turn posted inside a thread wakes that thread\'s agent only', async () => {
    const { useCase, woken } = makeUseCase(
      [waitingMention('m1', 'A'), waitingMention('m2', 'B'), waitingMention('m3', 'C')],
      { m2: 'th1', m3: 'th2' },
    );
    await useCase.execute('T', [], { threadId: 'th1' });
    expect(woken).toEqual(['B']);
  });

  it('without a comment store (older wiring) every waiting agent still wakes', async () => {
    const woken: string[] = [];
    const uc = new WakeWaitingAgentsUseCase(
      { getWaitingByTicket: async () => [waitingMention('m1', 'A'), waitingMention('m2', 'B')] } as never,
      { wakeUp: async (m: TicketMentionEntity) => { woken.push(m.targetAgent); } } as never,
      { info() {}, warn() {}, error() {}, debug() {} } as never,
    );
    await uc.execute('T', [], { threadId: null });
    expect(woken.sort()).toEqual(['A', 'B']);
  });
});
