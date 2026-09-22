import { describe, it, expect } from 'vitest';
import { RunAssistantTurnUseCase, type SdkRunner } from '../../src/application/use-cases/run-assistant-turn.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { EventBus } from '../../src/application/event-bus.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

class FakeCommentStore {
  saved: TicketCommentEntity[] = [];
  async save(c: TicketCommentEntity) { this.saved.push(c); }
  async getById(id: string) { return this.saved.find((c) => c.id === id) ?? null; }
  async getByTicket(ticketId: string) { return this.saved.filter((c) => c.ticketId === ticketId); }
}
class FakeMentionStore {
  saved: TicketMentionEntity[] = [];
  async save(m: TicketMentionEntity) { const i = this.saved.findIndex((x) => x.id === m.id); if (i >= 0) this.saved[i] = m; else this.saved.push(m); }
  async getById(id: string) { return this.saved.find((m) => m.id === id) ?? null; }
  async getByTicket(ticketId: string) { return this.saved.filter((m) => m.ticketId === ticketId); }
}
class FakeThreadStore {
  saved = new Map<string, AgentThreadEntity>();
  async getById(id: string) { return this.saved.get(id) ?? null; }
  async getByTicket(ticketId: string) { return [...this.saved.values()].filter((t) => t.ticketId === ticketId); }
  async getByCurrentMentionId(m: string) { return [...this.saved.values()].find((t) => t.currentMentionId === m) ?? null; }
  async getOpen() { return [...this.saved.values()].filter((t) => !t.isTerminal); }
  async save(t: AgentThreadEntity) { this.saved.set(t.id, t); }
}
class FakeAgentEventStore {
  executions: unknown[] = []; events: unknown[] = [];
  async startExecution(p: unknown) { this.executions.push(p); }
  async appendEvent(e: unknown) { this.events.push(e); }
  async completeExecution() {}
  async updateSessionId() {}
  async getSessionHistory() { return new Map(); }
}
class FakeExecuteAgent {
  cancelled: string[] = []; woken: string[] = [];
  async cancelExecutionForMention(id: string) { this.cancelled.push(id); return true; }
  async wakeUp(m: TicketMentionEntity) { this.woken.push(m.id); }
}

function persona(name: string) {
  return AgentPersonaEntity.create({ id: `p-${name}`, name, displayName: name === 'nas' ? 'Nas' : 'The Builder' });
}

function harness(actions: Array<Record<string, unknown>>) {
  const ticket = TicketEntity.create({ id: 't1', boardId: 'b', displayId: 1, title: 'e2e rouges' });
  ticket.updateExecutionConfig({ assistantPersonaId: 'p-nas' });
  const personas = [persona('nas'), persona('builder')];
  const comments = new FakeCommentStore();
  const mentions = new FakeMentionStore();
  const threads = new FakeThreadStore();
  const agentEvents = new FakeAgentEventStore();
  const executeAgent = new FakeExecuteAgent();
  const eventBus = new EventBus();
  const emitted: string[] = [];
  eventBus.on('*', (e) => { emitted.push(e.type); });
  const postComment = new PostCommentUseCase(comments as never, mentions as never, { saveActivity: async () => {} } as never, logger as never);
  const runner: SdkRunner = async () => ({ resultText: '', structuredOutput: actions.shift() ?? null, metrics: {} });
  const uc = new RunAssistantTurnUseCase({
    threadStore: threads as never, commentStore: comments as never, mentionStore: mentions as never,
    ticketStore: { getTicketById: async () => ticket, saveTicket: async () => {} } as never,
    personaStore: {
      getById: async (id: string) => personas.find((p) => p.id === id) ?? null,
      getByName: async (n: string) => personas.find((p) => p.name === n) ?? null,
      getAll: async () => personas,
    } as never,
    postComment,
    getTicketContext: {
      execute: async () => ({
        ticket: ticket.toDTO(), comments: (await comments.getByTicket('t1')).map((c) => c.toDTO()),
        mentions: { pending: [], all: [] }, deliverables: [], activity: [], relevantSummaries: [], epics: [], memorySnippets: [],
      }),
    } as never,
    agentEventStore: agentEvents as never, executeAgent: executeAgent as never,
    config: { get: () => ({ basePath: '', defaultShell: '', repositoryRefreshIntervalMs: 0 }) } as never,
    eventBus, logger: logger as never,
  }, runner);
  return { uc, ticket, comments, mentions, threads, agentEvents, executeAgent, emitted, actions };
}

const user = (commentId: string) => ({ kind: 'user_message' as const, commentId });

describe('RunAssistantTurnUseCase', () => {
  it('reply → one assistant comment in the main stream, no thread', async () => {
    const h = harness([{ action: 'reply', message: 'Bonjour', question: { text: 'On y va ?', options: ['Oui', 'Non'] } }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved).toHaveLength(1);
    const c = h.comments.saved[0]!;
    expect(c.authorType).toBe('assistant');
    expect(c.authorName).toBe('Nas');
    expect(c.threadId).toBeNull();
    expect(c.body).toBe('Bonjour\n\nOn y va ?\n- Oui\n- Non');
    expect(h.threads.saved.size).toBe(0);
    expect(h.emitted).toContain('comment.posted');
    expect(h.agentEvents.executions).toHaveLength(1);
    expect((h.agentEvents.executions[0] as { mentionId: string }).mentionId).toMatch(/^assistant:/);
  });

  it('delegate → announcement, thread, opening turn with a mention, thread.created', async () => {
    const h = harness([{ action: 'delegate', personaName: 'builder', brief: 'Fix e2e', forward: ['ticket', 'pr'], turn: 'Corrige les e2e', message: 'Je vois ça avec The Builder' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved.map((c) => [c.threadId === null, c.body])).toEqual([
      [true, 'Je vois ça avec The Builder'],
      [false, '@agent:builder Corrige les e2e'],
    ]);
    const thread = [...h.threads.saved.values()][0]!;
    expect(thread.personaName).toBe('builder');
    expect(thread.status).toBe('running');
    expect(thread.exchanges).toBe(1);
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.currentMentionId).toBe(h.mentions.saved[0]!.id);
    expect(h.emitted).toEqual(expect.arrayContaining(['thread.created', 'mention.created', 'comment.posted']));
  });

  it('delegate on a persona that already has an open thread becomes continue_thread', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'delegate', personaName: 'builder', brief: 'B', turn: 'deux' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.threads.saved.size).toBe(1);
    expect([...h.threads.saved.values()][0]!.exchanges).toBe(2);
    expect(h.mentions.saved).toHaveLength(2);
  });

  it('continue_thread on a waiting thread wakes the existing mention instead of creating one', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'continue_thread', threadId: 'SET_BELOW', turn: 'voici la réponse' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    thread.markWaiting(); await h.threads.save(thread);
    const m = h.mentions.saved[0]!; m.acknowledge(); m.waitForInfo(); await h.mentions.save(m);
    h.ticket.update({ blocked: true });
    h.actions[0]!.threadId = thread.id;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'waiting_for_info' } });
    expect(h.mentions.saved).toHaveLength(1);
    expect(h.executeAgent.woken).toEqual([m.id]);
    expect(h.ticket.blocked).toBe(false);
    expect(h.comments.saved.at(-1)!.threadId).toBe(thread.id);
    expect(thread.status).toBe('running');
  });

  it('conclude_thread → summary, terminal status, main-stream report, cancel of a live mention', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'conclude_thread', threadId: 'SET_BELOW', summary: 'Fix livré.', question: { text: 'Push ?', options: ['Push it', 'Hold'] } },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const mentionId = thread.currentMentionId;
    h.actions[0]!.threadId = thread.id;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: thread.id } });
    expect(thread.status).toBe('concluded');
    expect(thread.summary).toBe('Fix livré.');
    expect(h.executeAgent.cancelled).toEqual([mentionId]);
    expect(h.mentions.saved[0]!.status).toBe('resolved');
    const report = h.comments.saved.at(-1)!;
    expect(report.threadId).toBeNull();
    expect(report.body).toBe('Retour de The Builder : Fix livré.\n\nPush ?\n- Push it\n- Hold');
    expect(h.emitted).toContain('thread.concluded');
  });

  it('conclude_request forces conclude_thread whatever the model answers', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'reply', message: 'je préfère continuer' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: thread.id } });
    expect(thread.status).toBe('concluded');
    expect(thread.summary).toBe('je préfère continuer');
  });

  it('invalid output → one short assistant comment, nothing else', async () => {
    const h = harness([{ action: 'dance' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved).toHaveLength(1);
    expect(h.comments.saved[0]!.body).toMatch(/pas pu traiter/);
    expect(h.threads.saved.size).toBe(0);
  });

  it('does nothing when no assistant persona is configured', async () => {
    const h = harness([{ action: 'reply', message: 'x' }]);
    h.ticket.updateExecutionConfig({ assistantPersonaId: null });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved).toHaveLength(0);
  });

  it('serialises turns per ticket', async () => {
    const order: string[] = [];
    const h = harness([]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    (h.uc as unknown as { sdkRunner: SdkRunner }).sdkRunner = async () => {
      const me = ++n; order.push(`start${me}`);
      if (me === 1) await gate;
      order.push(`end${me}`);
      return { resultText: '', structuredOutput: { action: 'reply', message: `r${me}` }, metrics: {} };
    };
    const p1 = h.uc.execute({ ticketId: 't1', trigger: user('a') });
    const p2 = h.uc.execute({ ticketId: 't1', trigger: user('b') });
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
  });
});

describe('RunAssistantTurnUseCase — failures', () => {
  it('continue_thread on a failed thread relaunches the agent with a new mention', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'continue_thread', threadId: 'SET_BELOW', turn: 'reprends où tu en étais' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    thread.fail(); await h.threads.save(thread);
    h.actions[0]!.threadId = thread.id;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'failed' } });
    expect(thread.status).toBe('running');
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.currentMentionId).toBe(h.mentions.saved[1]!.id);
  });

  it('after MAX_THREAD_FAILURES the relaunch becomes a conclusion reported to the user', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'continue_thread', threadId: 'SET_BELOW', turn: 'encore' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    thread.fail(); thread.fail(); thread.fail(); await h.threads.save(thread);
    h.actions[0]!.threadId = thread.id;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'failed' } });
    expect(thread.status).toBe('concluded');
    expect(h.comments.saved.at(-1)!.body).toMatch(/3 tentatives/);
    expect(h.mentions.saved).toHaveLength(1);
  });

  it('ticket_created runs a turn without a user comment', async () => {
    const h = harness([{ action: 'reply', message: 'Je prends le ticket.' }]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'ticket_created' } });
    expect(h.comments.saved.map((c) => c.body)).toEqual(['Je prends le ticket.']);
  });
});

describe('RunAssistantTurnUseCase — execution mode', () => {
  it('delegate with mode: edit switches the ticket conversation mode before the turn', async () => {
    const h = harness([{ action: 'delegate', personaName: 'builder', brief: 'A', turn: 'écris le code', mode: 'edit' }]);
    expect(h.ticket.conversationMode).toBe('plan');
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.ticket.conversationMode).toBe('edit');
    expect(h.emitted).toContain('ticket.updated');
  });

  it('a turn without mode leaves the ticket mode alone', async () => {
    const h = harness([{ action: 'delegate', personaName: 'builder', brief: 'A', turn: 'lis le code' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.ticket.conversationMode).toBe('plan');
    expect(h.emitted).not.toContain('ticket.updated');
  });
});
