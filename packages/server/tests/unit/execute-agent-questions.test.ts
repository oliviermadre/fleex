import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/application/utils/stream-sdk-query.js', async (orig) => ({
  ...(await orig<typeof import('../../src/application/utils/stream-sdk-query.js')>()),
  streamSdkQuery: vi.fn(),
}));

import { streamSdkQuery } from '../../src/application/utils/stream-sdk-query.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';

const mockedStream = streamSdkQuery as unknown as ReturnType<typeof vi.fn>;

function makeUseCase() {
  const persona = { id: 'p1', name: 'builder', model: 'claude-opus-5-5' } as never;
  const skill = { id: 's1', personaId: 'p1', commandName: 'pr-review', displayName: 'PR Review', markdownContent: '' };
  const agentEventStore = {
    startExecution: vi.fn(async () => {}), appendEvent: vi.fn(async () => {}),
    completeExecution: vi.fn(async () => {}), updateSessionId: vi.fn(async () => {}),
  } as never;
  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  const postCommentExecute = vi.fn(async () => ({ comment: { id: 'c1' }, createdMentions: [] }));
  const postComment = { execute: postCommentExecute } as never;
  const getTicketContext = {
    execute: async () => ({ ticket: { title: 'T', status: 'reviewing', links: [] }, comments: [], deliverables: [] }),
  } as never;
  const skillStore = { getById: async () => skill } as never;
  const ticketStore = { getTicketById: async () => null } as never;
  const sdkLimiter = { acquire: async () => () => {} } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const config = { get: () => ({}) } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, stub, postComment, stub, stub, getTicketContext, agentEventStore, ticketStore, stub, config, logger, stub, sdkLimiter, skillStore,
  );
  const u = useCase as unknown as Record<string, unknown>;
  u['resolveHumanMentionName'] = () => null;
  u['composeSystemPrompt'] = () => 'system prompt';
  u['ensureWorkspace'] = async () => '/tmp/ws';
  u['composeSkillUserPrompt'] = async () => ({ blocks: [{ type: 'text', text: 'review it' }], manifest: [] });
  return { useCase, postCommentExecute };
}

const run = (structuredOutput: Record<string, unknown>) => ({
  sessionId: 'sess', resultText: 'ok', structuredOutput, metrics: { numTurns: 3 }, messageCount: 10, stderr: '',
});

describe('ExecuteAgentUseCase — declared questions reach the posted comment', () => {
  it('passes sanitized questions when the agent waits for info', async () => {
    mockedStream.mockResolvedValueOnce(run({
      deliverable: null, comment: 'Front ?', mentionStatus: 'waiting_for_info',
      questions: [{ prompt: 'Front ?', options: ['Ici', 'Séparé', 4] }],
    }));
    const { useCase, postCommentExecute } = makeUseCase();
    await useCase.executeForSkill('s1', 'T1');
    expect(postCommentExecute).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Front ?', questions: [{ prompt: 'Front ?', options: ['Ici', 'Séparé'] }],
    }));
  });

  it('passes null questions when the agent is done', async () => {
    mockedStream.mockResolvedValueOnce(run({
      deliverable: null, comment: 'Done', questions: [{ prompt: 'P', options: ['A', 'B'] }],
    }));
    const { useCase, postCommentExecute } = makeUseCase();
    await useCase.executeForSkill('s1', 'T1');
    expect(postCommentExecute).toHaveBeenCalledWith(expect.objectContaining({ body: 'Done', questions: null }));
  });
});
