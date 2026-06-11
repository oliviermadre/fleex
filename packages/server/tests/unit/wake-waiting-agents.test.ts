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

function makeUseCase(waiting: TicketMentionEntity[]) {
  const woken: string[] = [];
  const mentionStore = { getWaitingByTicket: async () => waiting } as never;
  const executeAgent = { wakeUp: async (m: TicketMentionEntity) => { woken.push(m.targetAgent); } } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  return { useCase: new WakeWaitingAgentsUseCase(mentionStore, executeAgent, logger), woken };
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
