import { describe, it, expect } from 'vitest';
import { GetTicketContextUseCase } from '../../src/application/use-cases/get-ticket-context.js';
import { sessionKeyFor } from '../../src/application/use-cases/execute-agent.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

/**
 * A run launched from an assistant thread is walled off. Without the wall, a
 * thread agent received the whole ticket — 50 comments of the human ⇄ assistant
 * discussion and every deliverable — and failed on « Prompt is too long ».
 */
const D_SHARED = '11111111-aaaa-4aaa-8aaa-111111111111';
const D_OTHER = '22222222-bbbb-4bbb-8bbb-222222222222';
const D_OWN = '33333333-cccc-4ccc-8ccc-333333333333';
const D_SIBLING = '44444444-dddd-4ddd-8ddd-444444444444';

function fixture() {
  const comment = (id: string, authorType: 'user' | 'assistant' | 'agent', body: string, threadId: string | null = null) =>
    TicketCommentEntity.create({ id, ticketId: 't1', authorType, authorName: authorType, body, threadId });
  const comments = [
    comment('m1', 'user', 'discussion privée avec l\'assistant'),
    comment('m2', 'assistant', 'réponse de l\'assistant dans le fil principal'),
    comment('a1', 'assistant', '@agent:builder fais X', 'thA'),
    comment('a2', 'agent', 'fait', 'thA'),
    comment('b1', 'assistant', '@agent:catalyst spécifie Y', 'thB'),
  ];
  const mention = (id: string, commentId: string, target: string) =>
    TicketMentionEntity.create({ id, ticketId: 't1', commentId, targetAgent: target, sourceAgent: 'Nas' });
  const mentions = [mention('mA', 'a1', 'builder'), mention('mB', 'b1', 'catalyst')];
  const deliv = (id: string, title: string, mentionId: string | null) =>
    TicketDeliverableEntity.create({ id, ticketId: 't1', agentName: 'x', type: 'report', title, content: 'c', mentionId });
  const deliverables = [deliv(D_SHARED, 'exposé', null), deliv(D_OTHER, 'non exposé', null), deliv(D_OWN, 'produit par le thread', 'mA'), deliv(D_SIBLING, 'produit par l\'autre thread', 'mB')];
  const ticket = TicketEntity.create({ id: 't1', boardId: 'b', displayId: 1, title: 'T' });
  const annotations = [{ toDTO: () => ({ id: 'an1', body: 'épinglé depuis le fil principal' }) }];
  const uc = new GetTicketContextUseCase(
    { getTicketById: async () => ticket, getActivitiesByTicket: async () => [] } as never,
    { getByTicket: async () => comments } as never,
    { getByTicket: async () => mentions } as never,
    { getByTicket: async () => deliverables } as never,
    undefined, undefined, undefined,
    { listByTicket: async () => annotations } as never,
  );
  return uc;
}

describe('GetTicketContextUseCase — a thread run is walled off', () => {
  it('reads its own thread only: neither the human ⇄ assistant discussion nor the other threads', async () => {
    const ctx = await fixture().execute({ ticketId: 't1', agentName: 'builder', thread: { id: 'thA', deliverableIds: [] } });
    expect(ctx.comments.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(ctx.mentions.all.map((m) => m.id)).toEqual(['mA']);
    expect(ctx.annotations).toEqual([]);
  });

  it('reads the deliverables the assistant exposed and the ones the thread produced — no other', async () => {
    const ctx = await fixture().execute({ ticketId: 't1', agentName: 'builder', thread: { id: 'thA', deliverableIds: [D_SHARED] } });
    expect(ctx.deliverables.map((d) => d.id).sort()).toEqual([D_SHARED, D_OWN].sort());
  });

  it('with nothing exposed, only what the thread produced', async () => {
    const ctx = await fixture().execute({ ticketId: 't1', agentName: 'builder', thread: { id: 'thA', deliverableIds: [] } });
    expect(ctx.deliverables.map((d) => d.id)).toEqual([D_OWN]);
  });

  it('a run outside any thread reads the ticket as before', async () => {
    const ctx = await fixture().execute({ ticketId: 't1', agentName: 'builder' });
    expect(ctx.comments).toHaveLength(5);
    expect(ctx.deliverables).toHaveLength(4);
    expect(ctx.annotations).toHaveLength(1);
  });
});

describe('sessionKeyFor — one SDK session per thread', () => {
  it('two threads with the same persona on the same ticket never share a session', () => {
    const first = sessionKeyFor('builder', 't1', { id: 'thA', deliverableIds: [] });
    const second = sessionKeyFor('builder', 't1', { id: 'thB', deliverableIds: [] });
    expect(first).not.toBe(second);
    // Nor with the persona's session outside threads.
    expect(sessionKeyFor('builder', 't1', null)).not.toBe(first);
    // The same thread keeps its session from one turn to the next.
    expect(sessionKeyFor('builder', 't1', { id: 'thA', deliverableIds: [D_SHARED] })).toBe(first);
  });
});

describe('AgentThreadEntity — what the thread may read', () => {
  const make = (forwardedContext: string[]) => AgentThreadEntity.create({ id: 'th', ticketId: 't1', personaId: 'p', personaName: 'builder', assistantPersonaId: 'pa', brief: 'b', forwardedContext });

  it('the assistant adds and removes deliverables while the thread is open', () => {
    const t = make([D_SHARED]);
    expect(t.shareDeliverables([D_OTHER, D_SHARED])).toEqual([D_SHARED, D_OTHER]);
    expect(t.shareDeliverables([], [D_SHARED])).toEqual([D_OTHER]);
    expect(t.toDTO().forwardedContext).toEqual([D_OTHER]);
  });

  it('a thread opened before the walling-off (decorative keys) exposes nothing', () => {
    expect(make(['ticket', 'pr', 'deliverables']).sharedDeliverableIds).toEqual([]);
  });
});
