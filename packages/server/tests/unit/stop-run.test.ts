import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AgentThreadTargetType } from '@fleex/shared';
import { EventBus } from '../../src/application/event-bus.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { StopRunUseCase } from '../../src/application/use-cases/stop-run.js';
import { CancelWorkflowRunUseCase } from '../../src/application/use-cases/cancel-workflow-run.js';
import { AssistantThreadListener } from '../../src/application/assistant-thread-listener.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { agentExecutionRoutes } from '../../src/infrastructure/http/agent-execution.routes.js';
import { agentEventsRoutes } from '../../src/infrastructure/http/agent-events.routes.js';
import { assistantThreadsRoutes } from '../../src/infrastructure/http/assistant-threads.routes.js';
import { workflowRunRoutes } from '../../src/infrastructure/http/workflow-run.routes.js';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';

/**
 * Lot 2 — « les actions de l'humain priment ». Every way a run can be stopped
 * goes through StopRunUseCase with its author, and a wanted stop is not a
 * failure. These tests run the REAL scheduler (ExecuteAgentUseCase), the real
 * stop use case, the real thread listener and the real HTTP routes, on
 * in-memory stores: what is asserted is what production records.
 */

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));
const AGENT = { 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'builder' };

interface ExecRow { id: string; mentionId: string; ticketId: string; status: string; startedAt: string; stoppedBy: string | null; stopReason: string | null }

function world(targetType: AgentThreadTargetType = 'agent') {
  const bus = new EventBus();
  const events: Array<{ type: string; mentionId?: string; reason?: string; resolvedBy?: string }> = [];
  bus.on('*', (e) => { events.push(e as never); });

  const mentionRows = new Map<string, TicketMentionEntity>();
  const mentionStore = {
    getById: async (id: string) => mentionRows.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...mentionRows.values()].filter((m) => m.ticketId === ticketId),
    getPendingForAgent: async () => [],
    save: async (m: TicketMentionEntity) => { mentionRows.set(m.id, m); },
  };
  const threadRows = new Map<string, AgentThreadEntity>();
  const threadStore = {
    getById: async (id: string) => threadRows.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...threadRows.values()].filter((t) => t.ticketId === ticketId),
    getByCurrentMentionId: async (m: string) => [...threadRows.values()].find((t) => t.currentMentionId === m) ?? null,
    getOpen: async () => [...threadRows.values()].filter((t) => t.status === 'running' || t.status === 'waiting'),
    save: async (t: AgentThreadEntity) => { threadRows.set(t.id, t); },
  };
  const execs = new Map<string, ExecRow>();
  const agentEventStore = {
    appendEvent: async () => {},
    completeExecution: async (id: string, status: string) => { const e = execs.get(id); if (e) e.status = status; },
    markExecutionsStopped: async (ids: string[], by: string, reason?: string | null) => {
      for (const id of ids) { const e = execs.get(id); if (e) { e.stoppedBy = by; e.stopReason = reason ?? null; } }
    },
    getExecutionsByTicket: async (ticketId: string) => [...execs.values()].filter((e) => e.ticketId === ticketId),
    markInterruptedExecutions: async () => [],
    getSessionHistory: async () => new Map(),
  };
  const stub = {} as never;
  const executeAgent = new ExecuteAgentUseCase(
    { getById: async () => ({ id: 'p1', name: 'builder' }), getByName: async () => ({ id: 'p1', name: 'builder' }) } as never,
    mentionStore as never, stub, stub, stub, stub, agentEventStore as never, stub, stub, stub, logger as never, stub,
    { run: (fn: () => Promise<unknown>) => fn() } as never, stub,
  );
  executeAgent.eventBus = bus;

  // ── Workflow engine (in memory) ──
  const runRows = new Map<string, WorkflowRunEntity>();
  const runStore = {
    getById: async (id: string) => runRows.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...runRows.values()].filter((r) => r.ticketId === ticketId),
    save: async (r: WorkflowRunEntity) => { runRows.set(r.id, r); },
  };
  const stepRows: StepRunEntity[] = [];
  const stepRunStore = {
    getByWorkflowRun: async (runId: string) => stepRows.filter((s) => s.workflowRunId === runId),
    save: async () => {},
  };
  const cancelWorkflowRun = new CancelWorkflowRunUseCase(runStore as never, stepRunStore as never, executeAgent, bus);

  const stopRun = new StopRunUseCase({
    executeAgent, agentEventStore: agentEventStore as never, threadStore: threadStore as never, mentionStore: mentionStore as never,
    workflowRunStore: runStore as never, stepRunStore: stepRunStore as never, eventBus: bus, logger: logger as never,
  });
  stopRun.cancelWorkflowRun = cancelWorkflowRun;

  // ── The assistant, as the listener would wake it ──
  const turns: Array<{ ticketId: string; trigger: { kind: string; threadId?: string; mentionStatus?: string } }> = [];
  const runAssistantTurn = { execute: async (p: never) => { turns.push(p); }, resolveAssistantPersona: async () => null, workflowRunOf: async () => null };
  const commentRows = new Map<string, TicketCommentEntity>();
  const commentStore = {
    getById: async (id: string) => commentRows.get(id) ?? null,
    getByTicket: async () => [...commentRows.values()],
    save: async (c: TicketCommentEntity) => { commentRows.set(c.id, c); },
  };
  new AssistantThreadListener({
    eventBus: bus, threadStore: threadStore as never, commentStore: commentStore as never,
    runAssistantTurn: runAssistantTurn as never, logger: logger as never, workflowRunStore: runStore as never,
  }).register();

  // ── A thread on its first turn: mention m1, acknowledged ──
  const thread = AgentThreadEntity.create({
    id: 'th1', ticketId: 't1', personaId: 'p1', personaName: 'builder', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [], targetType,
  });
  thread.openTurn('m1');
  threadRows.set(thread.id, thread);
  const mention = TicketMentionEntity.create({ id: 'm1', ticketId: 't1', commentId: 'c1', targetAgent: 'builder', sourceAgent: 'nas', targetType });
  mention.acknowledge();
  mentionRows.set(mention.id, mention);

  const active = (executeAgent as unknown as { activeExecutions: Map<string, { abortController: AbortController }> }).activeExecutions;
  /** A live run: tracked by the scheduler under `key`, with its row in the store. */
  const track = (key: string, executionId: string, triggerMentionId?: string) => {
    const abortController = new AbortController();
    active.set(key, { mentionId: key, executionId, personaId: 'p1', ticketId: 't1', status: 'running', abortController, ...(triggerMentionId ? { triggerMentionId } : {}) } as never);
    execs.set(executionId, { id: executionId, mentionId: key, ticketId: 't1', status: 'running', startedAt: new Date(Date.now() - 65_000).toISOString(), stoppedBy: null, stopReason: null });
    return abortController;
  };

  const container = {
    stopRun, executeAgent, agentEventStore, threadStore, mentionStore, commentStore, eventBus: bus, runAssistantTurn,
    ticketStore: { getTicketById: async () => ({ id: 't1' }) },
    config: { get: () => ({ humanDisplayName: 'Olivier' }) },
    postComment: new PostCommentUseCase(commentStore as never, mentionStore as never, { saveActivity: async () => {} } as never, logger as never),
    generateThreadTitle: { trigger() {} },
  };
  const app = async () => {
    const server = Fastify();
    await server.register(agentExecutionRoutes(container as never));
    await server.register(agentEventsRoutes(container as never));
    await server.register(assistantThreadsRoutes(container as never));
    await server.register(ticketRoutes(container as never));
    await server.register(workflowRunRoutes({ runStore, stepRunStore, cancelWorkflowRun, eventBus: bus } as never));
    return server;
  };

  /** A workflow run started by the thread's mention, with one step running `executionId`. */
  const seedWorkflowRun = (executionId: string) => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't1', templateId: 'tmpl',
      templateSnapshot: { name: 'W', emoji: '🔧', steps: [{ id: 'a', name: 'A', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } }], edges: [], entryStepId: 'a' },
      triggeredBy: 'nas', triggeredFrom: 'mention:m1',
    });
    runRows.set(run.id, run);
    const step = StepRunEntity.create({ id: 'sr-1', workflowRunId: run.id, stepId: 'a' });
    step.start();
    step.executionId = executionId;
    stepRows.push(step);
    track(`workflow:${executionId}`, executionId);
    return run;
  };

  return { bus, events, thread, mention, mentionRows, threadRows, execs, executeAgent, stopRun, turns, track, app, commentRows, seedWorkflowRun, runRows, cancelWorkflowRun };
}

/** What every wanted stop by the human must leave behind. */
function expectHeldByUser(w: ReturnType<typeof world>) {
  expect(w.thread.status).toBe('idle');
  expect(w.thread.userHoldAt).toBeInstanceOf(Date);
  expect(w.thread.lastStop).toMatchObject({ by: 'user', mentionId: 'm1' });
  expect(w.thread.failures).toBe(0);
  // Not a failure: no failed mention (hence no crash card), no failure event (hence no stat)…
  expect(w.mentionRows.get('m1')!.status).toBe('resolved');
  expect(w.events.filter((e) => e.type === 'mention.execution_failed')).toEqual([]);
  // …and the assistant is not woken.
  expect(w.turns).toEqual([]);
}

describe('who stopped the run — one path, one author (user)', () => {
  it('Stop button of a run card (POST /executions/:id/terminate-manual) → user', async () => {
    const w = world();
    const abort = w.track('m1', 'x1');
    const res = await (await w.app()).inject({ method: 'POST', url: '/api/executions/x1/terminate-manual', payload: { reason: 'user_requested' } });
    await tick();
    expect(res.statusCode).toBe(200);
    expect(abort.signal.aborted).toBe(true);
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'user', stopReason: 'user_requested' });
    expectHeldByUser(w);
    expect(w.events.map((e) => e.type)).toContain('thread.updated');
  });

  it('POST /executions/:id/cancel (execution log, mobile, CLI without agent identity) → user', async () => {
    const w = world();
    w.track('m1', 'x1');
    const res = await (await w.app()).inject({ method: 'POST', url: '/api/executions/x1/cancel' });
    await tick();
    expect(res.json()).toEqual({ cancelled: true });
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'user' });
    expectHeldByUser(w);
  });

  it('POST /executions/:id/cancel answers 404 for a run that is not running, and touches nothing', async () => {
    const w = world();
    const res = await (await w.app()).inject({ method: 'POST', url: '/api/executions/gone/cancel' });
    expect(res.statusCode).toBe(404);
    expect(w.thread.status).toBe('running');
    expect(w.thread.userHoldAt).toBeNull();
  });

  it('« stop & redo » of a comment (mentionConflicts: supersede) → user', async () => {
    const w = world();
    w.track('m1', 'x1');
    const res = await (await w.app()).inject({
      method: 'POST', url: '/api/tickets/t1/comments',
      payload: { body: 'autre chose', mentionConflicts: [{ agent: 'builder', action: 'supersede' }] },
    });
    await tick();
    expect(res.statusCode).toBe(201);
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'user', stopReason: 'stop & redo' });
    expectHeldByUser(w);
  });

  it('the human concluding the thread (POST /threads/:id/conclude) → user, then the conclusion turn', async () => {
    const w = world();
    w.track('m1', 'x1');
    const res = await (await w.app()).inject({ method: 'POST', url: '/api/threads/th1/conclude' });
    await tick();
    expect(res.json()).toEqual({ accepted: true, runsAutoTerminated: 1 });
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'user' });
    expect(w.events.filter((e) => e.type === 'mention.execution_failed')).toEqual([]);
    // The only turn is the one the human asked for: no wake-up from the stop itself.
    expect(w.turns).toEqual([{ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: 'th1' } }]);
  });

  it('a workflow run cancelled from the UI or the CLI without agent identity (DELETE /workflows/runs/:id) → user; the thread does not fail', async () => {
    const w = world('workflow');
    const run = w.seedWorkflowRun('x-step');
    const res = await (await w.app()).inject({ method: 'DELETE', url: '/api/workflows/runs/run-1' });
    await tick();
    expect(res.statusCode).toBe(204);
    expect(run.status).toBe('cancelled');
    expect(run.cancelledBy).toBe('user');
    // The step that was running carries the same author.
    expect(w.execs.get('x-step')).toMatchObject({ status: 'interrupted', stoppedBy: 'user' });
    expect(w.thread.status).toBe('idle');
    expect(w.thread.userHoldAt).toBeInstanceOf(Date);
    expect(w.thread.failures).toBe(0);
    expect(w.turns).toEqual([]);
  });

  it('the Stop button on a step of the thread\'s workflow → user; whatever the run does next wakes nobody', async () => {
    const w = world('workflow');
    w.seedWorkflowRun('x-step');
    await (await w.app()).inject({ method: 'POST', url: '/api/executions/x-step/terminate-manual', payload: {} });
    await tick();
    expect(w.execs.get('x-step')).toMatchObject({ stoppedBy: 'user' });
    expect(w.thread.status).toBe('idle');
    expect(w.thread.userHoldAt).toBeInstanceOf(Date);
    // The run fails because its step was stopped: a consequence of the stop, not a failure to fix.
    w.bus.emit({ type: 'workflow.run_failed', workflowRunId: 'run-1', ticketId: 't1', occurredAt: new Date() } as never);
    await tick();
    expect(w.thread.status).toBe('idle');
    expect(w.thread.failures).toBe(0);
    expect(w.turns).toEqual([]);
  });
});

describe('who stopped the run — not the human', () => {
  it('a stop carrying an agent identity is not a human decision: system, and the run fails as before', async () => {
    const w = world();
    w.track('m1', 'x1');
    await (await w.app()).inject({ method: 'POST', url: '/api/executions/x1/cancel', headers: AGENT });
    await tick();
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'system' });
    expect(w.thread.userHoldAt).toBeNull();
    expect(w.thread.status).toBe('failed');
    expect(w.thread.failures).toBe(1);
    expect(w.turns.map((t) => t.trigger.mentionStatus)).toEqual(['failed']);
  });

  it('a workflow run cancelled with an agent identity → system: the thread fails and the assistant is told', async () => {
    const w = world('workflow');
    const run = w.seedWorkflowRun('x-step');
    await (await w.app()).inject({ method: 'DELETE', url: '/api/workflows/runs/run-1', headers: AGENT });
    await tick();
    expect(run.cancelledBy).toBe('system');
    expect(w.thread.status).toBe('failed');
    expect(w.thread.userHoldAt).toBeNull();
    expect(w.turns).toHaveLength(1);
  });

  it('a stop by the assistant parks the thread without a hold: it may relaunch', async () => {
    const w = world();
    w.track('m1', 'x1');
    const out = await w.stopRun.stopThread(w.thread, { by: 'assistant', reason: 'consigne changée' });
    await tick();
    expect(out).toMatchObject({ stopped: true, what: 'execution', executionIds: ['x1'] });
    expect(out.startedAt).toBe(w.execs.get('x1')!.startedAt);
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'assistant', stopReason: 'consigne changée' });
    expect(w.thread.status).toBe('idle');
    expect(w.thread.userHoldAt).toBeNull();
    expect(w.thread.lastStop).toMatchObject({ by: 'assistant', reason: 'consigne changée' });
    expect(w.thread.failures).toBe(0);
    expect(w.mentionRows.get('m1')!.status).toBe('resolved');
    expect(w.turns).toEqual([]);
  });
});

describe('outside threads nothing changes but the author on record', () => {
  it('a stopped run that drives no thread still fails its mention (Relancer card), now with stoppedBy', async () => {
    const w = world();
    w.threadRows.clear();
    w.track('m1', 'x1');
    await (await w.app()).inject({ method: 'POST', url: '/api/executions/x1/cancel' });
    await tick();
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'user' });
    expect(w.mentionRows.get('m1')!.status).toBe('failed');
    expect(w.events).toContainEqual(expect.objectContaining({ type: 'mention.execution_failed', mentionId: 'm1', reason: 'cancelled' }));
  });
});

describe('every target type can be stopped', () => {
  it('a skill run is keyed `skill:<id>` by the scheduler: it is found through the mention that launched it', async () => {
    const w = world('skill');
    const abort = w.track('skill:s1', 'x-skill', 'm1');
    const out = await w.stopRun.stopThread(w.thread, { by: 'assistant', reason: 'inutile' });
    await tick();
    expect(out).toMatchObject({ stopped: true, what: 'execution', executionIds: ['x-skill'] });
    expect(abort.signal.aborted).toBe(true);
    expect(w.execs.get('x-skill')).toMatchObject({ status: 'interrupted', stoppedBy: 'assistant' });
    // The skill run itself never closes its mention once aborted: the stop does.
    expect(w.mentionRows.get('m1')!.status).toBe('resolved');
    expect(w.thread.status).toBe('idle');
    expect(w.turns).toEqual([]);
  });

  it('a panel is several sessions for one mention: all are aborted, and the synthesis must not start afterwards', async () => {
    const w = world('panel');
    const a = new AbortController();
    const b = new AbortController();
    w.executeAgent.registerExecution({ executionId: 'x-a', personaId: 'p1', ticketId: 't1', abortController: a, mentionId: 'm1' });
    w.executeAgent.registerExecution({ executionId: 'x-b', personaId: 'p2', ticketId: 't1', abortController: b, mentionId: 'm1' });
    expect(w.executeAgent.isStopRequested('m1')).toBe(false);

    const out = await w.stopRun.stopThread(w.thread, { by: 'user' });
    await tick();
    expect(out.executionIds.sort()).toEqual(['x-a', 'x-b']);
    expect(a.signal.aborted && b.signal.aborted).toBe(true);
    // RunPanelUseCase reads this between its members and its synthesis.
    expect(w.executeAgent.isStopRequested('m1')).toBe(true);
    expectHeldByUser(w);
  });

  it('the Stop button on ONE panel member drops that member only: the panel goes on, the thread is not stopped', async () => {
    const w = world('panel');
    const a = new AbortController();
    const b = new AbortController();
    w.executeAgent.registerExecution({ executionId: 'x-a', personaId: 'p1', ticketId: 't1', abortController: a, mentionId: 'm1' });
    w.executeAgent.registerExecution({ executionId: 'x-b', personaId: 'p2', ticketId: 't1', abortController: b, mentionId: 'm1' });
    await (await w.app()).inject({ method: 'POST', url: '/api/executions/x-a/terminate-manual', payload: {} });
    await tick();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(w.executeAgent.isStopRequested('m1')).toBe(false);
    expect(w.thread.status).toBe('running');
    expect(w.thread.userHoldAt).toBeNull();
  });

  it('a turn still queued behind its lane is closed instead of left to start later', async () => {
    const w = world();
    const out = await w.stopRun.stopThread(w.thread, { by: 'assistant', reason: 'plus besoin' });
    expect(out).toMatchObject({ stopped: true, what: 'queued', executionIds: [] });
    expect(w.mentionRows.get('m1')!.status).toBe('resolved');
    expect(w.thread.status).toBe('idle');
  });

  it('nothing running: says so and leaves the thread as it is', async () => {
    const w = world();
    w.mention.resolve();
    w.thread.markIdle();
    const out = await w.stopRun.stopThread(w.thread, { by: 'assistant' });
    expect(out).toMatchObject({ stopped: false, what: 'nothing' });
    expect(w.thread.lastStop).toBeNull();
  });

  it('a workflow thread: the run is cancelled with the author, the thread stays open', async () => {
    const w = world('workflow');
    const run = w.seedWorkflowRun('x-step');
    const out = await w.stopRun.stopThread(w.thread, { by: 'assistant', reason: 'mauvais workflow' });
    await tick();
    expect(out).toMatchObject({ stopped: true, what: 'workflow_run', workflowRunId: 'run-1' });
    expect(run.status).toBe('cancelled');
    expect(run.cancelledBy).toBe('assistant');
    expect(w.execs.get('x-step')).toMatchObject({ stoppedBy: 'assistant', stopReason: 'mauvais workflow' });
    expect(w.thread.status).toBe('idle');
    expect(w.thread.isTerminal).toBe(false);
    expect(w.thread.failures).toBe(0);
    expect(w.turns).toEqual([]);
  });

  it('without a workflow engine the stop says it cannot be done, instead of pretending', async () => {
    const w = world('workflow');
    w.seedWorkflowRun('x-step');
    w.stopRun.cancelWorkflowRun = null;
    const out = await w.stopRun.stopThread(w.thread, { by: 'assistant' });
    expect(out.stopped).toBe(false);
    expect(out.unsupported).toMatch(/workflows/);
    expect(w.thread.status).toBe('running');
  });
});

describe('the hold is the human\'s to lift', () => {
  it('a late event of the stopped run never moves the thread nor wakes the assistant', async () => {
    const w = world('panel');
    w.track('m1', 'x1');
    await w.stopRun.stopThread(w.thread, { by: 'user' });
    // e.g. a panel posting its synthesis after the stop, or the scheduler failing the mention late.
    w.bus.emit({ type: 'mention.resolved', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', resolvedBy: 'panel:x', occurredAt: new Date() });
    w.bus.emit({ type: 'mention.execution_failed', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', reason: 'cancelled', message: 'x', occurredAt: new Date() } as never);
    await tick();
    expect(w.thread.status).toBe('idle');
    expect(w.thread.failures).toBe(0);
    expect(w.thread.userHoldAt).toBeInstanceOf(Date);
    expect(w.turns).toEqual([]);
  });

  it('the human writing in the thread lifts it', async () => {
    const w = world();
    w.track('m1', 'x1');
    await w.stopRun.stopThread(w.thread, { by: 'user' });
    const c = TicketCommentEntity.create({ id: 'c-user', ticketId: 't1', authorType: 'user', authorName: 'Olivier', body: 'en fait continue', threadId: 'th1' });
    w.commentRows.set(c.id, c);
    w.bus.emit({ type: 'comment.posted', commentId: c.id, ticketId: 't1', authorType: 'user', authorName: 'Olivier', createdMentions: [], threadId: 'th1', occurredAt: new Date() });
    await tick();
    expect(w.thread.userHoldAt).toBeNull();
  });

  it('an agent or the assistant writing in the thread does not', async () => {
    const w = world();
    w.track('m1', 'x1');
    await w.stopRun.stopThread(w.thread, { by: 'user' });
    const c = TicketCommentEntity.create({ id: 'c-agent', ticketId: 't1', authorType: 'agent', authorName: 'builder', body: 'je reprends ?', threadId: 'th1' });
    w.commentRows.set(c.id, c);
    w.bus.emit({ type: 'comment.posted', commentId: c.id, ticketId: 't1', authorType: 'agent', authorName: 'builder', createdMentions: [], threadId: 'th1', occurredAt: new Date() });
    await tick();
    expect(w.thread.userHoldAt).toBeInstanceOf(Date);
  });

  it('« Relancer » (POST /threads/:id/relaunch) lifts it and hands the thread back to the assistant as a human request', async () => {
    const w = world();
    w.track('m1', 'x1');
    await w.stopRun.stopThread(w.thread, { by: 'user' });
    w.events.length = 0;
    const res = await (await w.app()).inject({ method: 'POST', url: '/api/threads/th1/relaunch' });
    expect(res.statusCode).toBe(202);
    expect(w.thread.userHoldAt).toBeNull();
    expect(w.events.map((e) => e.type)).toContain('thread.updated');
    expect(w.turns).toEqual([{ ticketId: 't1', trigger: { kind: 'relaunch_request', threadId: 'th1' } }]);
  });

  it('« Relancer » refuses a thread that is already running or closed', async () => {
    const w = world();
    const server = await w.app();
    expect((await server.inject({ method: 'POST', url: '/api/threads/th1/relaunch' })).statusCode).toBe(409);
    w.thread.conclude('fini');
    expect((await server.inject({ method: 'POST', url: '/api/threads/th1/relaunch' })).statusCode).toBe(409);
    expect((await server.inject({ method: 'POST', url: '/api/threads/nope/relaunch' })).statusCode).toBe(404);
    expect(w.turns).toEqual([]);
  });

  it('a later stop by the assistant neither renews nor erases the human\'s hold', async () => {
    const w = world();
    w.track('m1', 'x1');
    await w.stopRun.stopThread(w.thread, { by: 'user' });
    const heldAt = w.thread.userHoldAt;
    w.thread.recordStop('assistant', 'autre');
    expect(w.thread.userHoldAt).toBe(heldAt);
  });
});

describe('ExecuteAgentUseCase.cancelExecution with an author', () => {
  it('records the author before aborting, and leaves the mention to the caller when asked to', async () => {
    const w = world();
    const abort = w.track('m1', 'x1');
    expect(await w.executeAgent.cancelExecution('x1', { by: 'assistant', reason: 'r', keepMention: true })).toBe(true);
    expect(abort.signal.aborted).toBe(true);
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'assistant', stopReason: 'r' });
    expect(w.mentionRows.get('m1')!.status).toBe('acknowledged');
  });

  it('knows which mention a running execution works for, whatever its key', () => {
    const w = world();
    w.track('m1', 'x-agent');
    w.track('skill:s1', 'x-skill', 'm2');
    w.track('workflow:x-step', 'x-step');
    expect(w.executeAgent.mentionOfRunningExecution('x-agent')).toBe('m1');
    expect(w.executeAgent.mentionOfRunningExecution('x-skill')).toBe('m2');
    expect(w.executeAgent.mentionOfRunningExecution('x-step')).toBeNull();
    expect(w.executeAgent.mentionOfRunningExecution('unknown')).toBeUndefined();
    expect(w.executeAgent.runningExecutionIdsForMention('m2')).toEqual(['x-skill']);
  });
});

// Lot 7b — the surveillance's stop. Not a wanted stop: the opposite outcome on the thread.
describe('StopRunUseCase.stopStalled — a silent run is ended as a failure by the system', () => {
  it('aborts the hung session as system, fails the mention with the cause (not « cancelled »), and the thread fails and wakes the assistant once', async () => {
    const w = world();
    const abort = w.track('m1', 'x1');
    expect(await w.stopRun.stopStalled(w.thread, 'Aucun événement depuis 70 min.')).toBe(true);
    await tick();

    expect(abort.signal.aborted).toBe(true);
    expect(w.execs.get('x1')).toMatchObject({ status: 'interrupted', stoppedBy: 'system', stopReason: 'stalled' });
    expect(w.mentionRows.get('m1')!.status).toBe('failed');
    // One failure announced, carrying the real cause.
    expect(w.events.filter((e) => e.type === 'mention.execution_failed').map((e) => e.reason)).toEqual(['stalled']);
    // A failure, not a stop: no hold, no lastStop, the failure counted.
    expect(w.thread).toMatchObject({ status: 'failed', failures: 1, userHoldAt: null, lastStop: null });
    expect(w.turns).toEqual([{
      ticketId: 't1',
      trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'failed', failure: { reason: 'stalled', message: 'Aucun événement depuis 70 min.' } },
    }]);
  });

  it('ends nothing when the run settled meanwhile', async () => {
    const w = world();
    w.mention.resolve();
    expect(await w.stopRun.stopStalled(w.thread, 'x')).toBe(false);
    await tick();
    expect(w.mentionRows.get('m1')!.status).toBe('resolved');
    expect(w.events.filter((e) => e.type === 'mention.execution_failed')).toEqual([]);
    expect(w.turns).toEqual([]);
  });

  it('workflow: the run is cancelled as system with the cause on the event, its step aborted', async () => {
    const w = world('workflow');
    w.mention.resolve();
    const run = w.seedWorkflowRun('x-step');
    expect(await w.stopRun.stopStalled(w.thread, 'Le run ne progressait plus.')).toBe(true);
    await tick();
    expect(run).toMatchObject({ status: 'cancelled', cancelledBy: 'system' });
    expect(w.execs.get('x-step')).toMatchObject({ status: 'interrupted', stoppedBy: 'system' });
    expect((w.events.find((e) => e.type === 'workflow.run_cancelled') as { reason?: string }).reason).toBe('Le run ne progressait plus.');
    expect(w.thread).toMatchObject({ status: 'failed', failures: 1, userHoldAt: null });
    expect(w.turns).toHaveLength(1);
    expect(w.turns[0]!.trigger).toMatchObject({ mentionStatus: 'failed', failure: { reason: 'stalled', message: 'Le run ne progressait plus.' } });
  });
});
