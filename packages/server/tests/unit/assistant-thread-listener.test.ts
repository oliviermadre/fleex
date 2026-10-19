import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/application/event-bus.js';
import { AssistantThreadListener } from '../../src/application/assistant-thread-listener.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const thread = AgentThreadEntity.create({ id: 'th1', ticketId: 't1', personaId: 'p', personaName: 'builder', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [] });
  thread.openTurn('m1');
  const saved: string[] = [];
  const threadStore = {
    getByCurrentMentionId: async (id: string) => (id === 'm1' ? thread : null),
    getById: async (id: string) => (id === 'th1' ? thread : null),
    save: async (t: AgentThreadEntity) => { saved.push(t.status); },
  };
  const turns: unknown[] = [];
  const runAssistantTurn = { execute: async (p: unknown) => { turns.push(p); } };
  const commentStore = { getById: async (id: string) => (id === 'c-thread' ? { threadId: 'th1', authorType: 'user' } : { threadId: null, authorType: 'user' }) };
  const bus = new EventBus();
  const emitted: string[] = [];
  bus.on('thread.updated', () => { emitted.push('thread.updated'); });
  new AssistantThreadListener({ eventBus: bus, threadStore: threadStore as never, commentStore: commentStore as never, runAssistantTurn: runAssistantTurn as never, logger: logger as never }).register();
  return { bus, thread, saved, turns, emitted };
}

describe('AssistantThreadListener', () => {
  it('mention.resolved on the thread mention → agent turn counted, assistant re-run', async () => {
    const s = setup();
    s.bus.emit({ type: 'mention.resolved', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', resolvedBy: 'builder', occurredAt: new Date() });
    await tick();
    expect(s.thread.exchanges).toBe(2);
    expect(s.saved).toEqual(['idle']);
    expect(s.turns).toEqual([{ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'resolved' } }]);
    expect(s.emitted).toEqual(['thread.updated']);
  });

  it('mention.waiting_for_info → thread waiting, assistant re-run', async () => {
    const s = setup();
    s.bus.emit({ type: 'mention.waiting_for_info', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', occurredAt: new Date() });
    await tick();
    expect(s.thread.status).toBe('waiting');
    expect(s.turns).toHaveLength(1);
  });

  it('mention.execution_failed → thread failed, assistant informed', async () => {
    const s = setup();
    s.bus.emit({ type: 'mention.execution_failed', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', reason: 'max_turns', message: 'Reached maximum number of turns (20)', occurredAt: new Date() } as never);
    await tick();
    expect(s.thread.status).toBe('failed');
    // The scheduler's verdict travels with the trigger so the assistant relaunches for the right cause.
    expect((s.turns[0] as { trigger: unknown }).trigger).toEqual({
      kind: 'thread_reply', threadId: 'th1', mentionStatus: 'failed',
      failure: { reason: 'max_turns', message: 'Reached maximum number of turns (20)' },
    });
  });

  it('mention.woken_up → back to running, no assistant turn', async () => {
    const s = setup();
    s.thread.markWaiting();
    s.bus.emit({ type: 'mention.woken_up', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', occurredAt: new Date() });
    await tick();
    expect(s.thread.status).toBe('running');
    expect(s.turns).toHaveLength(0);
  });

  it('a user comment inside the thread counts an exchange; a main-stream one does not', async () => {
    const s = setup();
    s.bus.emit({ type: 'comment.posted', commentId: 'c-thread', ticketId: 't1', authorType: 'user', authorName: 'o', createdMentions: [], occurredAt: new Date() });
    s.bus.emit({ type: 'comment.posted', commentId: 'c-main', ticketId: 't1', authorType: 'user', authorName: 'o', createdMentions: [], occurredAt: new Date() });
    await tick();
    expect(s.thread.exchanges).toBe(2);
  });

  it('ignores mentions that belong to no thread and terminal threads', async () => {
    const s = setup();
    s.thread.conclude('done');
    s.bus.emit({ type: 'mention.resolved', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', resolvedBy: 'b', occurredAt: new Date() });
    s.bus.emit({ type: 'mention.resolved', mentionId: 'other', ticketId: 't1', targetAgent: 'x', resolvedBy: 'x', occurredAt: new Date() });
    await tick();
    expect(s.turns).toHaveLength(0);
  });
});

describe('AssistantThreadListener — workflow threads follow their run', () => {
  function setupWorkflow(runStatus = 'running') {
    const thread = AgentThreadEntity.create({
      id: 'thw', ticketId: 't1', personaId: 'w', personaName: 'review', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [], targetType: 'workflow',
    });
    thread.openTurn('mw');
    const run = { id: 'r1', triggeredFrom: 'mention:mw', status: runStatus };
    const threadStore = {
      getByCurrentMentionId: async (id: string) => (id === 'mw' ? thread : null),
      getById: async () => thread,
      save: async () => {},
    };
    const turns: Array<{ trigger: Record<string, unknown> }> = [];
    const bus = new EventBus();
    new AssistantThreadListener({
      eventBus: bus, threadStore: threadStore as never, commentStore: { getById: async () => null } as never,
      runAssistantTurn: { execute: async (p: never) => { turns.push(p); } } as never, logger: logger as never,
      workflowRunStore: { getById: async (id: string) => (id === 'r1' ? run : { id, triggeredFrom: 'manual', status: 'completed' }) } as never,
    }).register();
    const wf = (type: string) => bus.emit({ type, workflowRunId: 'r1', ticketId: 't1', stepRunId: 's', stepId: 's', occurredAt: new Date() } as never);
    return { bus, thread, run, turns, wf };
  }

  // The workflow mention is resolved as soon as the run is created: waking on it would
  // tell the assistant the work is done while the first step is barely starting.
  it('ignores the mention settling at run start', async () => {
    const s = setupWorkflow();
    s.bus.emit({ type: 'mention.resolved', mentionId: 'mw', ticketId: 't1', targetAgent: 'review', resolvedBy: 'x', occurredAt: new Date() });
    await tick();
    expect(s.thread.status).toBe('running');
    expect(s.turns).toHaveLength(0);
  });

  it('a run that could not start (mention failed) fails the thread', async () => {
    const s = setupWorkflow();
    s.bus.emit({ type: 'mention.execution_failed', mentionId: 'mw', ticketId: 't1', targetAgent: 'review', reason: 'workflow_start_failed', message: 'already active', occurredAt: new Date() } as never);
    await tick();
    expect(s.thread.status).toBe('failed');
    expect(s.turns).toHaveLength(1);
  });

  it('run completed → idle, assistant woken with the run', async () => {
    const s = setupWorkflow('completed');
    s.wf('workflow.run_completed');
    await tick();
    expect(s.thread.status).toBe('idle');
    expect(s.turns[0]!.trigger).toMatchObject({ kind: 'thread_reply', mentionStatus: 'resolved', workflowRun: { id: 'r1', status: 'completed' } });
  });

  it('run failed or cancelled → failed, assistant woken', async () => {
    for (const [type, status] of [['workflow.run_failed', 'failed'], ['workflow.run_cancelled', 'cancelled']] as const) {
      const s = setupWorkflow(status);
      s.wf(type);
      await tick();
      expect(s.thread.status).toBe('failed');
      expect(s.turns[0]!.trigger).toMatchObject({ mentionStatus: 'failed', workflowRun: { status } });
    }
  });

  it('a human gate parks the thread in waiting and wakes the assistant once; the next step resumes it silently', async () => {
    const s = setupWorkflow('needs_review');
    s.wf('workflow.needs_review');
    await tick();
    s.wf('workflow.awaiting_routing');
    await tick();
    expect(s.thread.status).toBe('waiting');
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]!.trigger).toMatchObject({ mentionStatus: 'waiting_for_info' });
    s.wf('workflow.step_started');
    await tick();
    expect(s.thread.status).toBe('running');
    expect(s.turns).toHaveLength(1);
  });

  it('ignores runs it did not start', async () => {
    const s = setupWorkflow();
    s.bus.emit({ type: 'workflow.run_completed', workflowRunId: 'r-other', ticketId: 't1', occurredAt: new Date() } as never);
    await tick();
    expect(s.thread.status).toBe('running');
    expect(s.turns).toHaveLength(0);
  });
});
