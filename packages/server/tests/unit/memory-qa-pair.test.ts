import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryEventListener } from '../../src/application/memory/memory-event-listener.js';
import { EventBus } from '../../src/application/event-bus.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { DraftChunk } from '../../src/application/memory/chunker.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const TICKET = { id: 't1', displayId: 687, title: 'idle time', boardId: 'b1', tags: [], links: [] };

let comments: TicketCommentEntity[];
let ingested: DraftChunk[][];

function comment(id: string, authorType: 'user' | 'agent', body: string, at: string, parentId: string | null = null) {
  const d = new Date(at);
  comments.push(new TicketCommentEntity(id, 't1', authorType, authorType === 'user' ? 'NaS' : 'The Builder', body, 'public' as never, [], [], parentId, d, d));
}

async function wake() {
  const bus = new EventBus();
  new MemoryEventListener({
    bus,
    kernel: { ingest: async (_k: string, _id: string, drafts: DraftChunk[]) => { ingested.push(drafts); } } as never,
    config: { get: () => ({ memoryEngine: 'semantic' }) } as never,
    ticketStore: { getTicketById: async () => TICKET } as never,
    commentStore: { getByTicket: async () => comments } as never,
    deliverableStore: {} as never, personaStore: {} as never, skillStore: {} as never,
    mentionStore: { getById: async () => ({ id: 'm1', commentId: 'req', targetAgent: 'builder' }) } as never,
    logger: silent as never,
  }).register();
  bus.emit({ type: 'mention.woken_up', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', occurredAt: new Date() } as never);
  await vi.runAllTimersAsync();
  return ingested[0]![0]!.content;
}

beforeEach(() => {
  vi.useFakeTimers();
  comments = [];
  ingested = [];
});
afterEach(() => vi.useRealTimers());

describe('qa_pair on mention.woken_up', () => {
  it('pairs the agent\'s own question with the answer, not the request that started the exchange', async () => {
    comment('req', 'user', '@agent:builder pourquoi ?', '2026-10-18T10:00:00Z');
    comment('q-old', 'agent', 'First draft of a question', '2026-10-18T10:01:00Z', 'req');
    comment('q', 'agent', 'Which date for idle time? (a) closure (b) last activity', '2026-10-18T10:02:00Z', 'req');
    comment('ans', 'user', '(a) Done/Cancelled → date de fermeture', '2026-10-18T10:05:00Z');

    const content = await wake();

    expect(content).toBe('**Question** (builder):\nWhich date for idle time? (a) closure (b) last activity\n\n**Answer**:\n(a) Done/Cancelled → date de fermeture');
  });

  it('labels the human request as a request when the agent\'s question cannot be found', async () => {
    comment('req', 'user', '@agent:builder pourquoi ?', '2026-10-18T10:00:00Z');
    comment('ans', 'user', '(a) Done/Cancelled', '2026-10-18T10:05:00Z');

    const content = await wake();

    expect(content.startsWith('**Request** (NaS):\n@agent:builder pourquoi ?')).toBe(true);
  });
});
