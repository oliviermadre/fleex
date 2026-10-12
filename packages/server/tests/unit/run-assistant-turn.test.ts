import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { RunAssistantTurnUseCase } from '../../src/application/use-cases/run-assistant-turn.js';
import type { AssistantLlm } from '../../src/application/assistant/assistant-llm.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { EventBus } from '../../src/application/event-bus.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { CliTool } from '../../src/application/assistant/fleex-cli-tools.js';

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
  executions: unknown[] = []; events: Array<{ eventType: string; data: unknown }> = [];
  async startExecution(p: unknown) { this.executions.push(p); }
  async appendEvent(e: { eventType: string; data: unknown }) { this.events.push(e); }
  async completeExecution() {}
}
class FakeExecuteAgent {
  cancelled: string[] = []; woken: string[] = [];
  async cancelExecutionForMention(id: string) { this.cancelled.push(id); return true; }
  async wakeUp(m: TicketMentionEntity) { this.woken.push(m.id); }
}

function persona(name: string) {
  return AgentPersonaEntity.create({ id: `p-${name}`, name, displayName: name === 'nas' ? 'Nas' : 'The Builder', model: 'claude-haiku-4-5-20251001' });
}

type Round = { text?: string; tools?: Array<{ name: string; input: Record<string, unknown> }> };

const showTool: CliTool = {
  name: 'fleex_ticket_show', commandPath: ['ticket', 'show'], description: 'Show', mutating: false, destructive: false,
  workspaceAware: true, jsonAware: true, inputSchema: { type: 'object', properties: {}, required: ['id'] },
  arguments: [{ key: 'id', required: true, variadic: false }], options: [],
};

function toolUse(name: string, input: Record<string, unknown>, id = 'tu'): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input } as Anthropic.ToolUseBlock;
}
function textBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text, citations: null } as Anthropic.TextBlock;
}
/** An LLM that always answers with the given content (used to script a second turn). */
function fixed(content: Anthropic.ContentBlock[]): AssistantLlm {
  return async (_p, onText) => {
    for (const b of content) if (b.type === 'text') onText(b.text);
    return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  };
}

/** Scripts the model: each round returns text and/or tool calls; text is streamed char-by-char. */
interface Catalogue {
  skills?: Array<{ id: string; commandName: string; name: string; displayName: string; markdownContent: string; enabled: boolean }>;
  workflows?: Array<{ id: string; slug: string; name: string; description: string; enabled: boolean }>;
  runs?: Array<{ id: string; ticketId: string; triggeredFrom: string; status: string; isActive(): boolean }>;
  deliverables?: Array<Record<string, unknown>>;
}

function run(id: string, triggeredFrom: string, status: string) {
  return { id, ticketId: 't1', triggeredFrom, status, isActive: () => ['running', 'blocked', 'needs_review'].includes(status) };
}

function harness(rounds: Round[], opts: { hasApiKey?: boolean } & Catalogue = {}) {
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
  const llmCalls: Array<{ system: string; tools: string[]; messages: Anthropic.MessageParam[] }> = [];
  const cliCalls: string[][] = [];
  let n = 0;
  const llm: AssistantLlm = async (params, onText) => {
    llmCalls.push({ system: params.system, tools: params.tools.map((t) => t.name), messages: params.messages });
    const r = rounds[n++] ?? { text: '' };
    if (r.text) for (const ch of r.text) onText(ch);
    const content: Anthropic.ContentBlock[] = [];
    if (r.text) content.push(textBlock(r.text));
    for (const [i, t] of (r.tools ?? []).entries()) content.push(toolUse(t.name, t.input, `tu-${n}-${i}`));
    return { content, stopReason: r.tools?.length ? 'tool_use' : 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } };
  };
  const uc = new RunAssistantTurnUseCase({
    threadStore: threads as never, commentStore: comments as never, mentionStore: mentions as never,
    ticketStore: { getTicketById: async () => ticket, saveTicket: async () => {} } as never,
    personaStore: {
      getById: async (id: string) => personas.find((p) => p.id === id) ?? null,
      getByName: async (nm: string) => personas.find((p) => p.name === nm) ?? null,
      getAll: async () => personas,
    } as never,
    postComment,
    getTicketContext: {
      execute: async () => ({
        ticket: ticket.toDTO(), comments: (await comments.getByTicket('t1')).map((c) => c.toDTO()),
        mentions: { pending: [], all: mentions.saved.map((m) => m.toDTO()) }, deliverables: opts.deliverables ?? [], activity: [], relevantSummaries: [], epics: [], memorySnippets: [],
      }),
    } as never,
    agentEventStore: agentEvents as never, executeAgent: executeAgent as never,
    config: { get: () => ({ basePath: '', defaultShell: '', repositoryRefreshIntervalMs: 0 }) } as never,
    eventBus, logger: logger as never,
    skillStore: {
      getEnabled: async () => (opts.skills ?? []).filter((x) => x.enabled),
      getByCommandName: async (n: string) => (opts.skills ?? []).find((x) => x.commandName === n) ?? null,
    } as never,
    panelStore: { getEnabled: async () => [], getByName: async () => null } as never,
    workflowTemplateStore: {
      getEnabled: async () => (opts.workflows ?? []).filter((x) => x.enabled),
      getBySlug: async (n: string) => (opts.workflows ?? []).find((x) => x.slug === n) ?? null,
    } as never,
    workflowRunStore: {
      getByTicket: async () => opts.runs ?? [],
      getActiveByTicket: async () => (opts.runs ?? []).find((r) => r.isActive()) ?? null,
    } as never,
    environment: {
      workspace: 'qa', cliBin: '/opt/fleex', hasApiKey: opts.hasApiKey ?? true,
      cliTools: async () => [showTool],
      runCli: async (argv: string[]) => { cliCalls.push(argv); return { ok: true, text: '{"id":"t1","title":"e2e rouges"}' }; },
    },
  }, llm);
  const setLlm = (next: AssistantLlm) => { (uc as unknown as { llm: AssistantLlm }).llm = next; };
  return { uc, ticket, comments, mentions, threads, agentEvents, executeAgent, emitted, llmCalls, cliCalls, setLlm };
}

const user = (commentId: string) => ({ kind: 'user_message' as const, commentId });
const delegateBuilder = { name: 'delegate', input: { targetType: 'agent', name: 'builder', brief: 'A', turn: 'un' } };

describe('RunAssistantTurnUseCase — conversation', () => {
  it('a plain text answer becomes one assistant comment, streamed as deltas in the execution log', async () => {
    const h = harness([{ text: 'Bonjour !\n\nOn y va ?\n- Oui\n- Non' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved.map((c) => [c.authorType, c.authorName, c.threadId, c.body])).toEqual([['assistant', 'Nas', null, 'Bonjour !\n\nOn y va ?\n- Oui\n- Non']]);
    const streamed = h.agentEvents.events.filter((e) => e.eventType === 'content_block_delta')
      .map((e) => (e.data as { message: { content: Array<{ text: string }> } }).message.content[0]!.text).join('');
    expect(streamed).toBe('Bonjour !\n\nOn y va ?\n- Oui\n- Non');
    expect((h.agentEvents.executions[0] as { model: string }).model).toBe('claude-haiku-4-5-20251001');
    expect(h.emitted).toContain('comment.posted');
  });

  it('the system prompt starts with the Fleex environment and exposes action + fleex tools', async () => {
    const h = harness([{ text: 'ok' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const call = h.llmCalls[0]!;
    expect(call.system.startsWith('# Environnement Fleex')).toBe(true);
    expect(call.system).toContain('**#1** · uuid `t1`');
    expect(call.system).toContain('Workspace Fleex : **qa**');
    expect(call.system).toContain('1 outils `fleex_*`');
    expect(call.system.length).toBeLessThan(12000);
    expect(call.tools).toEqual(['delegate', 'continue_thread', 'conclude_thread', 'request_mode', 'fleex_ticket_show']);
  });

  it('a fleex_* tool call runs the CLI and feeds the result back before the answer', async () => {
    const h = harness([{ tools: [{ name: 'fleex_ticket_show', input: { id: '1' } }] }, { text: 'Le ticket est en doing.' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.cliCalls).toEqual([['ticket', 'show', '1', '--workspace', 'qa', '--json']]);
    const second = h.llmCalls[1]!.messages;
    expect(second.length).toBeGreaterThanOrEqual(3);
    expect((second[2]!.content as Anthropic.ToolResultBlockParam[])[0]!.content).toContain('e2e rouges');
    expect(h.comments.saved.map((c) => c.body)).toEqual(['Le ticket est en doing.']);
  });

  it('says so when no Anthropic key is configured', async () => {
    const h = harness([{ text: 'never called' }], { hasApiKey: false });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.llmCalls).toHaveLength(0);
    expect(h.comments.saved[0]!.body).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('does nothing when no assistant persona is configured', async () => {
    const h = harness([{ text: 'x' }]);
    h.ticket.updateExecutionConfig({ assistantPersonaId: null });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved).toHaveLength(0);
  });

  it('serialises turns per ticket', async () => {
    const order: string[] = [];
    const h = harness([]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let k = 0;
    h.setLlm(async (_p, onText) => {
      const me = ++k; order.push(`start${me}`);
      if (me === 1) await gate;
      onText('x'); order.push(`end${me}`);
      return { content: [textBlock('x')], stopReason: 'end_turn' };
    });
    const p1 = h.uc.execute({ ticketId: 't1', trigger: user('a') });
    const p2 = h.uc.execute({ ticketId: 't1', trigger: user('b') });
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
  });
});

describe('RunAssistantTurnUseCase — thread actions as tools', () => {
  it('delegate (agent) → announcement, thread, opening turn with a mention, thread.created; empty final text posts nothing more', async () => {
    const h = harness([
      { tools: [{ name: 'delegate', input: { targetType: 'agent', name: 'builder', brief: 'Fix e2e', forward: ['ticket', 'pr'], turn: 'Corrige les e2e', message: 'Je vois ça avec The Builder' } }] },
      { text: '' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved.map((c) => [c.threadId === null, c.body])).toEqual([
      [true, 'Je vois ça avec The Builder'],
      [false, '@agent:builder Corrige les e2e'],
    ]);
    const thread = [...h.threads.saved.values()][0]!;
    expect(thread.status).toBe('running');
    expect(thread.exchanges).toBe(1);
    expect(thread.currentMentionId).toBe(h.mentions.saved[0]!.id);
    expect(h.emitted).toEqual(expect.arrayContaining(['thread.created', 'mention.created']));
  });

  it('a second thread action in the same turn is refused', async () => {
    const h = harness([{ tools: [delegateBuilder, { name: 'delegate', input: { targetType: 'agent', name: 'builder', brief: 'B', turn: 'deux' } }] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.mentions.saved).toHaveLength(1);
    const results = h.llmCalls[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(results[1]!.is_error).toBe(true);
  });

  it('delegate on a persona with an open thread becomes a continue', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }, { tools: [{ name: 'delegate', input: { targetType: 'agent', name: 'builder', brief: 'B', turn: 'deux' } }] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    // The first turn has settled (otherwise the continue is refused as "still working").
    const m = h.mentions.saved[0]!; m.acknowledge(); m.resolve(); await h.mentions.save(m);
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.threads.saved.size).toBe(1);
    expect(h.mentions.saved).toHaveLength(2);
  });

  it('continue_thread on a waiting thread wakes the mention, unblocks the ticket, creates no mention', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    thread.markWaiting(); await h.threads.save(thread);
    const m = h.mentions.saved[0]!; m.acknowledge(); m.waitForInfo(); await h.mentions.save(m);
    h.ticket.update({ blocked: true });
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'voici la réponse' })]));
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'waiting_for_info' } });
    expect(h.mentions.saved).toHaveLength(1);
    expect(h.executeAgent.woken).toEqual([m.id]);
    expect(h.ticket.blocked).toBe(false);
    expect(h.comments.saved.at(-1)!.threadId).toBe(thread.id);
    expect(thread.status).toBe('running');
  });

  it('continue_thread while the agent is still on its previous turn sends nothing and tells the model to wait', async () => {
    // Regression: a user message during a running turn made the assistant open a
    // second mention, which queued behind the first on the same lane for good.
    const continueRound: Round = { tools: [{ name: 'continue_thread', input: { threadId: '', turn: 'au fait, 999 tours maintenant' } }] };
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }, continueRound, { text: 'Je lui transmets dès la fin de son tour.' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    continueRound.tools![0]!.input['threadId'] = thread.id;
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.mentions.saved).toHaveLength(1);
    expect(h.executeAgent.woken).toEqual([]);
    expect(h.comments.saved.filter((c) => c.threadId === thread.id)).toHaveLength(1);
    const results = h.llmCalls[3]!.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(results[0]!.content).toMatch(/travaille encore sur le tour précédent/);
    expect(h.comments.saved.at(-1)!.body).toBe('Je lui transmets dès la fin de son tour.');
  });

  it('conclude_thread → terminal, live mention cancelled, « Retour de … » posted, thread.concluded', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const mentionId = thread.currentMentionId!;
    h.setLlm(fixed([toolUse('conclude_thread', { threadId: thread.id, summary: 'Fix livré.', question: { text: 'Push ?', options: ['Push it', 'Hold'] } })]));
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'resolved' } });
    expect(thread.status).toBe('concluded');
    expect(h.executeAgent.cancelled).toEqual([mentionId]);
    expect(h.mentions.saved[0]!.status).toBe('resolved');
    expect(h.comments.saved.at(-1)!.body).toBe('Retour de The Builder : Fix livré.\n\nPush ?\n- Push it\n- Hold');
    expect(h.emitted).toContain('thread.concluded');
  });

  it('conclude_request without a conclude tool call concludes with the model text as summary', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }, { text: 'je préfère continuer' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: thread.id } });
    expect(thread.status).toBe('concluded');
    expect(thread.summary).toBe('je préfère continuer');
  });

  it('request_mode → CTA comment, thread waiting, mode untouched', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    h.setLlm(fixed([toolUse('request_mode', { threadId: thread.id, mode: 'edit', message: 'The Builder doit écrire.' })]));
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'waiting_for_info' } });
    expect(h.ticket.conversationMode).toBe('plan');
    expect(thread.status).toBe('waiting');
    expect(h.comments.saved.at(-1)!.body).toBe(`The Builder doit écrire.\n\n<!-- fleex:mode-request {"mode":"edit","threadId":"${thread.id}"} -->`);
  });

  it('continue_thread on a failed thread relaunches; after MAX failures it concludes instead', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })]));
    const m = h.mentions.saved[0]!; m.acknowledge(); m.markFailed(); await h.mentions.save(m);
    thread.fail(); await h.threads.save(thread);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'failed' } });
    expect(thread.status).toBe('running');
    expect(h.mentions.saved).toHaveLength(2);
    thread.fail(); thread.fail(); thread.fail(); await h.threads.save(thread);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'failed' } });
    expect(thread.status).toBe('concluded');
    expect(h.comments.saved.at(-1)!.body).toMatch(/tentatives/);
  });

  it('ticket_created runs a turn without a user comment', async () => {
    const h = harness([{ text: 'Je prends le ticket.' }]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'ticket_created' } });
    expect(h.comments.saved.map((c) => c.body)).toEqual(['Je prends le ticket.']);
  });

  it('neither text nor action → one short apology comment', async () => {
    const h = harness([{ text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved).toHaveLength(1);
    expect(h.comments.saved[0]!.body).toMatch(/pas pu traiter/);
  });
});

describe('RunAssistantTurnUseCase — streaming order', () => {
  it('appends coalesced text deltas in sequence order even when the store is slow and out of order', async () => {
    const h = harness([{ text: 'A'.repeat(70) + 'B'.repeat(70) + 'C'.repeat(70) }]);
    // Store that resolves appends in reverse arrival order — the chain must still keep the sequence.
    const pending: Array<() => void> = [];
    const store = h.agentEvents as unknown as { appendEvent: (e: { eventType: string; data: unknown; sequence: number }) => Promise<void>; events: Array<{ eventType: string; data: unknown; sequence: number }> };
    const events: Array<{ eventType: string; data: unknown; sequence: number }> = [];
    store.appendEvent = (e) => new Promise<void>((resolve) => { pending.push(() => { events.push(e); resolve(); }); setTimeout(() => { const f = pending.pop(); f?.(); }, 1); });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const deltas = events.filter((e) => e.eventType === 'content_block_delta');
    const text = deltas.map((e) => ((e.data as { message: { content: Array<{ text: string }> } }).message.content[0]!.text)).join('');
    expect(text).toBe('A'.repeat(70) + 'B'.repeat(70) + 'C'.repeat(70));
    expect(deltas.map((e) => e.sequence)).toEqual([...deltas.map((e) => e.sequence)].sort((a, b) => a - b));
    expect(deltas.length).toBeLessThan(10);
  });
});

describe('RunAssistantTurnUseCase — delegating to skills, panels and workflows', () => {
  const lint = { id: 's-lint', commandName: 'lint', name: 'lint', displayName: 'Lint', markdownContent: '# Lint\nRuns the linter on the worktree.', enabled: true };
  const off = { id: 's-off', commandName: 'old', name: 'old', displayName: 'Old', markdownContent: 'Retired.', enabled: false };
  const review = { id: 'w-review', slug: 'review', name: 'Review', description: 'Code review then QA.', enabled: true };

  it('lists only the enabled skills and workflows in the system prompt, with what they do', async () => {
    const h = harness([{ text: 'ok' }], { skills: [lint, off], workflows: [review] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const system = h.llmCalls[0]!.system;
    expect(system).toContain('@skill:lint — Lint : Runs the linter on the worktree.');
    expect(system).not.toContain('@skill:old');
    expect(system).toContain('@workflow:review — Review : Code review then QA.');
  });

  it('a skill delegation opens a skill thread whose opening turn mentions @skill: and is tracked by that mention', async () => {
    const h = harness([{ tools: [{ name: 'delegate', input: { targetType: 'skill', name: 'lint', brief: 'Lint', turn: '--fix' } }] }, { text: '' }], { skills: [lint] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    expect([thread.targetType, thread.personaId, thread.personaName]).toEqual(['skill', 's-lint', 'lint']);
    expect(h.comments.saved.at(-1)!.body).toBe('@skill:lint --fix');
    expect(h.mentions.saved.map((m) => m.targetType)).toEqual(['skill']);
    expect(thread.currentMentionId).toBe(h.mentions.saved[0]!.id);
  });

  it('an unknown or disabled target opens nothing and tells the model what exists', async () => {
    const h = harness([{ tools: [{ name: 'delegate', input: { targetType: 'skill', name: 'old', brief: 'x', turn: 'y' } }] }, { text: '' }], { skills: [lint, off] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.threads.saved.size).toBe(0);
    expect(h.mentions.saved).toHaveLength(0);
    const result = (h.llmCalls[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(result.content).toContain('Skills disponibles : lint');
  });

  // One active run per ticket: a second one would be refused at creation and the thread would only fail.
  it('does not open a workflow thread while a run is already active on the ticket', async () => {
    const h = harness(
      [{ tools: [{ name: 'delegate', input: { targetType: 'workflow', name: 'review', brief: 'x', turn: 'y' } }] }, { text: '' }],
      { workflows: [review], runs: [run('r0', 'manual', 'needs_review')] },
    );
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.threads.saved.size).toBe(0);
    expect(h.mentions.saved).toHaveLength(0);
  });

  it('does not relaunch a workflow thread whose run is still waiting on a human gate', async () => {
    const h = harness([{ tools: [{ name: 'delegate', input: { targetType: 'workflow', name: 'review', brief: 'x', turn: 'y' } }] }, { text: '' }], { workflows: [review] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const posted = h.comments.saved.length;
    h.mentions.saved[0]!.resolve(); // a workflow mention settles as soon as its run starts
    // The run it started now waits on a gate.
    (h as unknown as { uc: { deps: { workflowRunStore: unknown } } }).uc.deps.workflowRunStore = {
      getByTicket: async () => [run('r1', `mention:${thread.currentMentionId}`, 'needs_review')],
      getActiveByTicket: async () => run('r1', `mention:${thread.currentMentionId}`, 'needs_review'),
    };
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'encore' })]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.comments.saved.length).toBe(posted);
    expect(h.mentions.saved).toHaveLength(1);
  });

  it("a workflow thread's results are its run's deliverables, read in full", async () => {
    const thread = AgentThreadEntity.create({
      id: 'th-w', ticketId: 't1', personaId: 'w-review', personaName: 'review', assistantPersonaId: 'p-nas', brief: 'x',
      forwardedContext: ['ticket'], targetType: 'workflow',
    });
    thread.openTurn('m-w');
    const h = harness([{ text: 'ok' }], {
      workflows: [review],
      runs: [run('r1', 'mention:m-w', 'completed')],
      deliverables: [
        { id: 'd1', title: 'QA report', type: 'report', status: 'final', agentName: 'workflow', createdAt: '2026-10-12T00:00:00Z', content: 'ALL GREEN', workflowRunId: 'r1', mentionId: null },
        { id: 'd2', title: 'Other', type: 'report', status: 'final', agentName: 'x', createdAt: '2026-10-12T00:00:00Z', content: 'UNRELATED', workflowRunId: 'r9', mentionId: null },
      ],
    });
    await h.threads.save(thread);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: 'th-w', mentionStatus: 'resolved', workflowRun: { id: 'r1', status: 'completed' } } });
    const prompt = h.llmCalls[0]!.messages[0]!.content as string;
    expect(prompt).toContain('ALL GREEN');
    expect(prompt).not.toContain('UNRELATED');
  });
});
