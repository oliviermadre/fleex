import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock only the SDK call; keep the real `isEmptyRun` predicate.
vi.mock('../../src/application/utils/stream-sdk-query.js', async (orig) => ({
  ...(await orig<typeof import('../../src/application/utils/stream-sdk-query.js')>()),
  streamSdkQuery: vi.fn(),
}));

import { isEmptyRun, streamSdkQuery } from '../../src/application/utils/stream-sdk-query.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';

const mockedStream = streamSdkQuery as unknown as ReturnType<typeof vi.fn>;

/**
 * A query that ends without doing anything (0 turn, empty result, no structured
 * output) must never pass for a completed run. Seen on a skill step retry: resuming
 * a session whose previous run left background agents behind, the CLI answered its
 * own "agents didn't finish" notification and ended before reading the new prompt —
 * the step got a fallback `ko` and the workflow routed on it.
 */
const EMPTY = { sessionId: 'old-sess', resultText: '', structuredOutput: null, metrics: { numTurns: 0 }, messageCount: 4, stderr: '' };
const DONE = { sessionId: 'new-sess', resultText: 'ok', structuredOutput: { result: 'ok' }, metrics: { numTurns: 7 }, messageCount: 30, stderr: '' };

describe('isEmptyRun', () => {
  it('flags a run with no turn, no text and no structured output', () => {
    expect(isEmptyRun(EMPTY)).toBe(true);
    expect(isEmptyRun({ ...EMPTY, metrics: {} })).toBe(true);
  });
  it('accepts any run that produced something', () => {
    expect(isEmptyRun(DONE)).toBe(false);
    expect(isEmptyRun({ ...EMPTY, resultText: 'answer' })).toBe(false);
    expect(isEmptyRun({ ...EMPTY, structuredOutput: { result: 'ok' } })).toBe(false);
    expect(isEmptyRun({ ...EMPTY, metrics: { numTurns: 3 } })).toBe(false);
  });
});

function makeUseCase() {
  const persona = { id: 'p1', name: 'builder', model: 'claude-opus-5-5' } as never;
  const skill = { id: 's1', personaId: 'p1', commandName: 'pr-review', displayName: 'PR Review', markdownContent: '' };
  const completeExecution = vi.fn(async () => {});
  const appendEvent = vi.fn(async () => {});
  const agentEventStore = {
    startExecution: vi.fn(async () => {}), appendEvent, completeExecution, updateSessionId: vi.fn(async () => {}),
  } as never;
  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  const postComment = { execute: async () => ({ comment: { id: 'c1' }, createdMentions: [] }) } as never;
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
  u['composeWorkflowUserPrompt'] = async () => ({ blocks: [{ type: 'text', text: 'do the step' }], manifest: [] });
  (u['sessionHistory'] as Map<string, string>).set('skill:pr-review:T1', 'old-sess');

  return { useCase, completeExecution, appendEvent };
}

const resumeOf = (call: unknown[]) => ((call[0] as { queryOptions: Record<string, unknown> }).queryOptions)['resume'];

describe('ExecuteAgentUseCase — a run that did nothing', () => {
  beforeEach(() => mockedStream.mockReset());

  it('a skill whose resumed session ends empty is retried once in a fresh session', async () => {
    mockedStream.mockResolvedValueOnce(EMPTY).mockResolvedValueOnce(DONE);
    const { useCase, completeExecution, appendEvent } = makeUseCase();

    const out = await useCase.executeForSkill('s1', 'T1', { returnStructured: true });

    expect(mockedStream).toHaveBeenCalledTimes(2);
    expect(resumeOf(mockedStream.mock.calls[0]!)).toBe('old-sess');
    expect(resumeOf(mockedStream.mock.calls[1]!)).toBeUndefined();
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'execution_retry' }));
    expect(out).toMatchObject({ structuredOutput: { result: 'ok' } });
    expect(completeExecution).toHaveBeenCalledWith(expect.any(String), 'completed', expect.anything());
  });

  it('a skill that still does nothing fails instead of completing', async () => {
    mockedStream.mockResolvedValue({ ...EMPTY, sessionId: 'new-sess' });
    const { useCase, completeExecution } = makeUseCase();

    await expect(useCase.executeForSkill('s1', 'T1', { returnStructured: true })).rejects.toThrow(/sans rien produire/);
    expect(completeExecution).not.toHaveBeenCalledWith(expect.any(String), 'completed', expect.anything());
    expect(completeExecution).toHaveBeenCalledWith(expect.any(String), 'failed', expect.anything());
  });

  it('an agent workflow step that does nothing fails instead of completing', async () => {
    mockedStream.mockResolvedValue(EMPTY);
    const { useCase, completeExecution } = makeUseCase();

    await expect(useCase.executeForWorkflowStep({
      personaName: 'builder', ticketId: 'T1', outputFormat: {} as never, workflowContextPrompt: 'ctx', mode: 'talk',
    })).rejects.toThrow();
    expect(completeExecution).not.toHaveBeenCalledWith(expect.any(String), 'completed', expect.anything());
  });
});
