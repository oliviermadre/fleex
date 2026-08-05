import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK stream seam so the test never touches the real Claude Agent SDK.
// The mock returns a `result` with rich metrics; the test asserts those metrics
// are threaded all the way into completeExecution + updateSessionId.
vi.mock('../../src/application/utils/stream-sdk-query.js', () => ({
  streamSdkQuery: vi.fn(),
}));

import { streamSdkQuery } from '../../src/application/utils/stream-sdk-query.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';

const mockedStream = streamSdkQuery as unknown as ReturnType<typeof vi.fn>;

const METRICS = {
  durationMs: 12_345,
  costUsd: 12.34,
  inputTokens: 540,
  outputTokens: 207_600,
  cacheReadTokens: 28_610_000,
  cacheCreationTokens: 1_110_000,
};

function makeUseCase() {
  // executionMode 'message' → effectiveMode 'talk' → skips worktree creation.
  const persona = { id: 'p1', name: 'Builder', executionMode: 'message', model: 'claude-opus-4-8' } as never;

  const completeExecution = vi.fn(async () => {});
  const updateSessionId = vi.fn(async () => {});
  const agentEventStore = {
    startExecution: vi.fn(async () => {}),
    appendEvent: vi.fn(async () => {}),
    updateSessionId,
    completeExecution,
  } as never;

  const personaStore = { getByName: async () => persona } as never;
  const getTicketContext = {
    execute: async () => ({
      ticket: { title: 'A ticket', status: 'todo', links: [] },
      comments: [],
      deliverables: [],
    }),
  } as never;
  // acquire() returns the (idempotent) release fn the method calls in finally.
  const sdkLimiter = { acquire: async () => () => {} } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const stub = {} as never;
  // The workflow-step path reads agentMaxTurns off the config when building the
  // SDK options; an empty object here would throw on .get().
  const config = { get: () => ({}) } as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore,   // 1 personaStore
    stub,           // 2 mentionStore
    stub,           // 3 postComment
    stub,           // 4 resolveMention
    stub,           // 5 submitDeliverable
    getTicketContext, // 6 getTicketContext
    agentEventStore,  // 7 agentEventStore
    stub,           // 8 ticketStore
    stub,           // 9 createWorktree
    config,         // 10 config
    logger,         // 11 logger
    stub,           // 12 autoReviewWorkflow
    sdkLimiter,     // 13 sdkLimiter
    stub,           // 14 skillStore
  );

  // Stub the prompt-composition internals so the test isolates the metrics
  // wiring (not prompt building). These are exercised by other tests.
  const u = useCase as unknown as Record<string, unknown>;
  u['resolveHumanMentionName'] = () => null;
  u['composeSystemPrompt'] = () => 'system prompt';
  u['composeWorkflowUserPrompt'] = async () => [{ type: 'text', text: 'do the step' }];

  return { useCase, completeExecution, updateSessionId };
}

describe('ExecuteAgentUseCase.executeForWorkflowStep — cost/token attribution', () => {
  beforeEach(() => {
    mockedStream.mockReset();
    mockedStream.mockResolvedValue({
      sessionId: 'sess-abc-123',
      resultText: 'done',
      structuredOutput: { mentionStatus: 'resolved' },
      resultSubtype: undefined,
      metrics: METRICS,
      messageCount: 5,
    });
  });

  it('persists SDK cost, token breakdown and session id on completion', async () => {
    const { useCase, completeExecution, updateSessionId } = makeUseCase();

    await useCase.executeForWorkflowStep({
      personaName: 'Builder',
      ticketId: 'T1',
      outputFormat: {} as never,
      workflowContextPrompt: 'context',
      mode: 'edit',
    });

    // The whole point of the fix: metrics reach completeExecution.
    expect(completeExecution).toHaveBeenCalledWith(
      expect.any(String),
      'completed',
      expect.objectContaining({
        costUsd: METRICS.costUsd,
        inputTokens: METRICS.inputTokens,
        outputTokens: METRICS.outputTokens,
        cacheReadTokens: METRICS.cacheReadTokens,
        cacheCreationTokens: METRICS.cacheCreationTokens,
      }),
    );

    // And the execution is linked to its transcript for resume + backfill.
    expect(updateSessionId).toHaveBeenCalledWith(expect.any(String), 'sess-abc-123');
  });
});
