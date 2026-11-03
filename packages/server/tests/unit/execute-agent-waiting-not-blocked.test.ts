import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/application/utils/stream-sdk-query.js', async (orig) => ({
  ...(await orig<typeof import('../../src/application/utils/stream-sdk-query.js')>()),
  streamSdkQuery: vi.fn(),
}));

import { streamSdkQuery } from '../../src/application/utils/stream-sdk-query.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

const mockedStream = streamSdkQuery as unknown as ReturnType<typeof vi.fn>;

/**
 * The ticket's `blocked` flag means one thing only: the human set it because they
 * cannot move forward. An agent asking a question (`waiting_for_info`) is not a
 * blocked ticket — it has its own "waiting" badge. So an agent run must never
 * touch `blocked`, neither to set it nor to clear a manual one.
 */
function makeUseCase(ticket: TicketEntity) {
  const persona = { id: 'p1', name: 'builder', model: 'claude-opus-5-5', executionMode: 'message' } as never;
  const mentions = new Map<string, TicketMentionEntity>();
  const mentionStore = {
    getById: async (id: string) => mentions.get(id) ?? null,
    getByTicket: async () => [...mentions.values()],
    save: async (m: TicketMentionEntity) => { mentions.set(m.id, m); },
  } as never;
  const agentEventStore = {
    startExecution: async () => {}, appendEvent: async () => {}, completeExecution: async () => {},
    updateSessionId: async () => {}, getSdkSessionBaseline: async () => ({ priorRuns: 0, latest: null }),
  } as never;
  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  const postComment = { execute: async () => ({ comment: { id: 'c-out' }, createdMentions: [] }) } as never;
  const getTicketContext = {
    execute: async () => ({ ticket: { title: 'T', status: 'doing', links: [] }, comments: [], deliverables: [] }),
  } as never;
  const saveTicket = vi.fn(async () => {});
  const saveActivity = vi.fn(async () => {});
  const ticketStore = { getTicketById: async () => ticket, saveTicket, saveActivity } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const config = { get: () => ({}) } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, mentionStore, postComment, stub, stub, getTicketContext, agentEventStore, ticketStore, stub, config, logger, stub, stub, stub,
  );
  const events: Array<{ type: string }> = [];
  useCase.eventBus = { emit: (e: never) => { events.push(e); } } as never;
  const u = useCase as unknown as Record<string, unknown>;
  u['resolveHumanMentionName'] = () => 'nas';
  u['composeSystemPrompt'] = () => 'system prompt';
  u['composeUserPrompt'] = async () => ({ blocks: [{ type: 'text', text: 'answer the mention' }], manifest: [] });

  const mention = TicketMentionEntity.create({
    id: 'm1', ticketId: ticket.id, commentId: 'c-in', targetAgent: 'builder', sourceAgent: 'user', targetType: 'agent',
  });
  mentions.set(mention.id, mention);

  const run = () => (useCase as unknown as {
    executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void>;
  }).executeForMention(persona, mention);

  return { run, mentions, events, saveActivity };
}

// Already claimed by the agent, so the run's own claim step emits nothing.
function claimedTicket(): TicketEntity {
  const t = TicketEntity.create({ id: 'T1', boardId: 'b', displayId: 1, title: 'T' });
  t.claim('builder');
  return t;
}

const askQuestion = {
  sessionId: 'sess', resultText: 'ok', metrics: { numTurns: 3 }, messageCount: 10, stderr: '',
  structuredOutput: { deliverable: null, comment: 'Option A ou B ?', mentionStatus: 'waiting_for_info', questions: null },
};

describe('ExecuteAgentUseCase — an agent waiting for info never touches the blocked flag', () => {
  beforeEach(() => mockedStream.mockReset());

  it('leaves an unblocked ticket unblocked, while still parking the mention', async () => {
    const ticket = claimedTicket();
    mockedStream.mockResolvedValueOnce(askQuestion);
    const { run, mentions, events, saveActivity } = makeUseCase(ticket);

    await run();

    expect(mentions.get('m1')!.status).toBe('waiting_for_info');
    expect(events).toContainEqual(expect.objectContaining({ type: 'mention.waiting_for_info', mentionId: 'm1' }));
    expect(ticket.blocked).toBe(false);
    expect(events.filter((e) => e.type === 'ticket.updated')).toEqual([]);
    expect(saveActivity).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'auto_blocked_waiting_for_info' }));
  });

  it('keeps a manually blocked ticket blocked', async () => {
    const ticket = claimedTicket();
    ticket.update({ blocked: true });
    mockedStream.mockResolvedValueOnce(askQuestion);
    const { run, mentions } = makeUseCase(ticket);

    await run();

    expect(mentions.get('m1')!.status).toBe('waiting_for_info');
    expect(ticket.blocked).toBe(true);
  });
});
