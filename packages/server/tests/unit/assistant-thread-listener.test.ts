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
