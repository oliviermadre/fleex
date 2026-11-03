import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * FLEEX_ACTOR_PERSONA — how an agent run tells the CLI which persona it is.
 *
 * Why it matters: a workflow step acts as `workflow:<template> → <step>`, a
 * name that matches no persona. Without the slug, an item assigned to
 * `builder` would never be "for you" in the Builder's step, and `todo assign
 * … me` would have nothing to resolve to. Each execution path builds its own
 * SDK options, so each one is pinned here.
 */
vi.mock('../../src/application/utils/stream-sdk-query.js', async (orig) => ({
  ...(await orig<typeof import('../../src/application/utils/stream-sdk-query.js')>()),
  streamSdkQuery: vi.fn(),
}));

import { streamSdkQuery } from '../../src/application/utils/stream-sdk-query.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { RunPanelUseCase } from '../../src/application/use-cases/run-panel.js';

const mockedStream = streamSdkQuery as unknown as ReturnType<typeof vi.fn>;
const DONE = { sessionId: 's', resultText: 'ok', structuredOutput: { result: 'ok' }, metrics: { numTurns: 3 }, messageCount: 5, stderr: '' };
const envOf = (call: unknown[]) =>
  ((call[0] as { queryOptions: Record<string, unknown> }).queryOptions.env ?? {}) as Record<string, string>;

const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
const config = { get: () => ({}) } as never;
const persona = { id: 'p1', name: 'builder', displayName: 'Builder', model: 'claude-opus-5-5' };

function executeAgent() {
  const skill = { id: 's1', personaId: 'p1', commandName: 'pr-review', displayName: 'PR Review', markdownContent: '' };
  const agentEventStore = {
    startExecution: vi.fn(async () => {}), appendEvent: vi.fn(async () => {}),
    completeExecution: vi.fn(async () => {}), updateSessionId: vi.fn(async () => {}),
  } as never;
  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  const postComment = { execute: async () => ({ comment: { id: 'c1' }, createdMentions: [] }) } as never;
  const getTicketContext = { execute: async () => ({ ticket: { title: 'T', status: 'doing', links: [] }, comments: [], deliverables: [] }) } as never;
  const stub = {} as never;
  const useCase = new ExecuteAgentUseCase(
    personaStore, stub, postComment, stub, stub, getTicketContext, agentEventStore, { getTicketById: async () => null } as never,
    stub, config, logger, stub, { acquire: async () => () => {} } as never, { getById: async () => skill } as never,
  );
  const u = useCase as unknown as Record<string, unknown>;
  u['resolveHumanMentionName'] = () => null;
  u['composeSystemPrompt'] = () => 'system prompt';
  u['ensureWorkspace'] = async () => '/tmp/ws';
  u['composeSkillUserPrompt'] = async () => ({ blocks: [{ type: 'text', text: 'review it' }], manifest: [] });
  u['composeWorkflowUserPrompt'] = async () => ({ blocks: [{ type: 'text', text: 'do the step' }], manifest: [] });
  return useCase;
}

describe('FLEEX_ACTOR_PERSONA — exported by every run that has a persona', () => {
  beforeEach(() => {
    mockedStream.mockReset();
    mockedStream.mockResolvedValue(DONE);
  });

  it('a workflow step: named after the step, but identified as its persona', async () => {
    await executeAgent().executeForWorkflowStep({
      personaName: 'builder', ticketId: 'T1', outputFormat: {} as never, workflowContextPrompt: 'ctx', mode: 'edit',
      actorName: 'workflow:Spec Dev PR (HITL) → Build',
    });
    const env = envOf(mockedStream.mock.calls[0]!);
    expect(env.FLEEX_ACTOR_NAME).toBe('workflow:Spec Dev PR (HITL) → Build');
    expect(env.FLEEX_ACTOR_PERSONA).toBe('builder');
  });

  it('a skill run', async () => {
    await executeAgent().executeForSkill('s1', 'T1', { returnStructured: true });
    expect(envOf(mockedStream.mock.calls[0]!).FLEEX_ACTOR_PERSONA).toBe('builder');
  });

  it('a panel member', async () => {
    const agentEventStore = { startExecution: async () => {}, appendEvent: async () => {}, completeExecution: async () => {} } as never;
    const stub = {} as never;
    const panel = new RunPanelUseCase(stub, stub, stub, stub, stub, stub, stub, stub, agentEventStore, config, logger, stub);
    await (panel as unknown as { queryMember: (...a: unknown[]) => Promise<unknown> }).queryMember(
      persona, 'claude-opus-5-5', 'topic', [], '🔨', null, 'talk', 'T1', 'm1',
      { title: 'T', status: 'doing', commentsCount: 0, deliverablesCount: 0 },
    );
    const env = envOf(mockedStream.mock.calls[0]!);
    expect(env.FLEEX_ACTOR_NAME).toBe('Builder');
    expect(env.FLEEX_ACTOR_PERSONA).toBe('builder');
  });
});
