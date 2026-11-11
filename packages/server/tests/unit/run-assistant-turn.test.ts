import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { RunAssistantTurnUseCase, assistantTurnCostUsd } from '../../src/application/use-cases/run-assistant-turn.js';
import { StopRunUseCase } from '../../src/application/use-cases/stop-run.js';
import type { AssistantLlm } from '../../src/application/assistant/assistant-llm.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { AssistantThreadListener } from '../../src/application/assistant-thread-listener.js';
import { EventBus } from '../../src/application/event-bus.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
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
  completed: Array<{ status: string; metrics: Record<string, unknown> }> = [];
  async completeExecution(_id: string, status: string, metrics: Record<string, unknown> = {}) { this.completed.push({ status, metrics }); }
  /** Latest execution per mention id; tests seed it to simulate a run the user (or a conclude) stopped. */
  byMention: Record<string, { manuallyTerminatedByUser?: boolean; autoTerminatedAtConclusion?: boolean }> = {};
  async getExecutionByMentionId(mentionId: string) { return this.byMention[mentionId] ?? null; }
  /** Who stopped which execution, as the single stop path records it. */
  stopped: Array<{ id: string; by: string; reason: string | null }> = [];
  async markExecutionsStopped(ids: string[], by: string, reason?: string | null) { for (const id of ids) this.stopped.push({ id, by, reason: reason ?? null }); }
  startedAt: Record<string, string> = {};
  async getExecutionsByTicket() { return Object.entries(this.startedAt).map(([id, startedAt]) => ({ id, startedAt })); }
}
/**
 * The process-side of a run: which executions are live for which mention.
 * `running` is seeded by the tests; cancelling an execution records its author
 * and, unless told to keep it, fails the mention — like the real scheduler.
 */
class FakeExecuteAgent {
  cancelled: string[] = []; woken: string[] = [];
  /** mentionId → live execution ids. */
  running: Record<string, string[]> = {};
  stops: Array<{ executionId: string; by?: string; reason?: string | null; keepMention?: boolean }> = [];
  constructor(private readonly agentEvents: FakeAgentEventStore, private readonly mentions: FakeMentionStore, private readonly bus: EventBus) {}
  runningExecutionIdsForMention(mentionId: string) { return [...(this.running[mentionId] ?? [])]; }
  mentionOfRunningExecution(executionId: string) {
    for (const [m, ids] of Object.entries(this.running)) if (ids.includes(executionId)) return m;
    return undefined;
  }
  async cancelExecution(executionId: string, stop?: { by: string; reason?: string | null; keepMention?: boolean }) {
    const mentionId = this.mentionOfRunningExecution(executionId);
    if (mentionId === undefined) return false;
    if (stop) await this.agentEvents.markExecutionsStopped([executionId], stop.by, stop.reason);
    this.running[mentionId] = this.running[mentionId]!.filter((id) => id !== executionId);
    this.stops.push({ executionId, ...stop });
    if (!stop?.keepMention) {
      const m = await this.mentions.getById(mentionId);
      if (m) {
        m.markFailed(); await this.mentions.save(m);
        this.bus.emit({ type: 'mention.execution_failed', mentionId, ticketId: m.ticketId, targetAgent: m.targetAgent, reason: 'cancelled', message: 'Run arrêté', occurredAt: new Date() });
      }
    }
    return true;
  }
  async cancelExecutionForMention(mentionId: string, stop?: { by: string; reason?: string | null; keepMention?: boolean }) {
    this.cancelled.push(mentionId);
    let any = false;
    for (const id of this.runningExecutionIdsForMention(mentionId)) any = (await this.cancelExecution(id, stop)) || any;
    return any;
  }
  async wakeUp(m: TicketMentionEntity) { this.woken.push(m.id); }
}

function persona(name: string) {
  return AgentPersonaEntity.create({ id: `p-${name}`, name, displayName: name === 'nas' ? 'Nas' : 'The Builder', model: 'claude-haiku-4-5-20251001' });
}

type Round = { text?: string; tools?: Array<{ name: string; input: Record<string, unknown> }> };

const showTool: CliTool = {
  name: 'fleex_ticket_show', commandPath: ['ticket', 'show'], description: 'Show', mutating: false,
  workspaceAware: true, jsonAware: true, inputSchema: { type: 'object', properties: {}, required: ['id'] },
  arguments: [{ key: 'id', required: true, variadic: false }], options: [],
};
const commentTool: CliTool = {
  name: 'fleex_ticket_comment', commandPath: ['ticket', 'comment'], description: 'Comment', mutating: true,
  workspaceAware: true, jsonAware: true, inputSchema: { type: 'object', properties: {}, required: ['id', 'body'] },
  arguments: [{ key: 'id', required: true, variadic: false }, { key: 'body', required: true, variadic: false }], options: [],
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
  extraCliTools?: CliTool[];
  skills?: Array<{ id: string; commandName: string; name: string; displayName: string; markdownContent: string; enabled: boolean }>;
  workflows?: Array<{ id: string; slug: string; name: string; description: string; enabled: boolean }>;
  runs?: Array<{ id: string; ticketId: string; triggeredFrom: string; status: string; startedAt: Date; isActive(): boolean }>;
  deliverables?: Array<Record<string, unknown>>;
}

function run(id: string, triggeredFrom: string, status: string) {
  return {
    id, ticketId: 't1', triggeredFrom, status, startedAt: new Date(Date.now() - 90_000),
    isActive(): boolean { return ['running', 'blocked', 'needs_review'].includes(this.status); },
  };
}

function harness(rounds: Round[], opts: { hasApiKey?: boolean; workThreadsEnabled?: boolean } & Catalogue = {}) {
  const ticket = TicketEntity.create({ id: 't1', boardId: 'b', displayId: 1, title: 'e2e rouges' });
  ticket.updateExecutionConfig({ assistantPersonaId: 'p-nas' });
  const personas = [persona('nas'), persona('builder')];
  const comments = new FakeCommentStore();
  const mentions = new FakeMentionStore();
  const threads = new FakeThreadStore();
  const agentEvents = new FakeAgentEventStore();
  const eventBus = new EventBus();
  const executeAgent = new FakeExecuteAgent(agentEvents, mentions, eventBus);
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
  const runStore = {
    getByTicket: async () => opts.runs ?? [],
    getActiveByTicket: async () => (opts.runs ?? []).find((r) => r.isActive()) ?? null,
  };
  // The real stop path, on the fakes: what the tests assert is what production records.
  const stopRun = new StopRunUseCase({
    executeAgent: executeAgent as never, agentEventStore: agentEvents as never, threadStore: threads as never,
    mentionStore: mentions as never, workflowRunStore: runStore as never, stepRunStore: null, eventBus, logger: logger as never,
  });
  const workflowCancels: Array<{ runId: string; by?: string; reason?: string | null }> = [];
  stopRun.cancelWorkflowRun = {
    execute: async (runId: string, stop?: { by: string; reason?: string | null }) => {
      workflowCancels.push({ runId, ...stop });
      const r = (opts.runs ?? []).find((x) => x.id === runId);
      if (r) { r.status = 'cancelled'; (r as { cancelledBy?: string }).cancelledBy = stop?.by; }
    },
  } as never;
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
    agentEventStore: agentEvents as never, executeAgent: executeAgent as never, stopRun,
    config: { get: () => ({ basePath: '', defaultShell: '', repositoryRefreshIntervalMs: 0, workThreadsEnabled: 'workThreadsEnabled' in opts ? opts.workThreadsEnabled : true }) } as never,
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
    workflowRunStore: runStore as never,
    environment: {
      workspace: 'qa', cliBin: '/opt/fleex', hasApiKey: opts.hasApiKey ?? true,
      cliTools: async () => [showTool, ...(opts.extraCliTools ?? [])],
      runCli: async (argv: string[]) => { cliCalls.push(argv); return { ok: true, text: '{"id":"t1","title":"e2e rouges"}' }; },
    },
  }, llm);
  const setLlm = (next: AssistantLlm) => { (uc as unknown as { llm: AssistantLlm }).llm = next; };
  return { uc, ticket, comments, mentions, threads, agentEvents, executeAgent, eventBus, stopRun, workflowCancels, emitted, llmCalls, cliCalls, setLlm };
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

  // What the user watched stream must be what stays: the live bubble used to show every
  // round's text glued together, then the posted comment kept only the last round's.
  it('text around a tool call: the posted comment is exactly what was streamed, rounds separated by a blank line', async () => {
    const h = harness([
      { text: 'Je regarde le ticket.', tools: [{ name: 'fleex_ticket_show', input: { id: 't1' } }] },
      { text: 'Il est en doing, rien à faire.' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const streamed = h.agentEvents.events
      .filter((e) => e.eventType === 'content_block_delta' && (e.data as { type: string }).type === 'assistant')
      .flatMap((e) => (e.data as { message: { content: Array<{ type: string; text?: string }> } }).message.content)
      .filter((b) => b.type === 'text').map((b) => b.text).join('');
    expect(h.comments.saved.map((c) => c.body)).toEqual(['Je regarde le ticket.\n\nIl est en doing, rien à faire.']);
    expect(streamed).toBe(h.comments.saved[0]!.body);
  });

  it('a round that says nothing adds no separator, so stream and comment still match', async () => {
    const h = harness([
      { tools: [{ name: 'fleex_ticket_show', input: { id: 't1' } }] },
      { text: 'Il est en doing.' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved.map((c) => c.body)).toEqual(['Il est en doing.']);
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
    expect(call.tools).toEqual(['delegate', 'continue_thread', 'stop_thread', 'conclude_thread', 'request_mode', 'fleex_ticket_show']);
  });

  it('a CLI comment carrying a mention tag is refused: it would launch a target outside any thread', async () => {
    const h = harness([
      { tools: [{ name: 'fleex_ticket_comment', input: { id: '1', body: '@agent:builder corrige les e2e' } }] },
      { tools: [{ name: 'fleex_ticket_comment', input: { id: '1', body: 'Note : e2e à revoir.' } }] },
      { text: 'Noté.' },
    ], { extraCliTools: [commentTool] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    // Only the tag-free comment reached the CLI.
    expect(h.cliCalls).toEqual([['ticket', 'comment', '1', 'Note : e2e à revoir.', '--workspace', 'qa', '--json']]);
    const refusal = (h.llmCalls[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(refusal.is_error).toBe(true);
    expect(refusal.content).toContain('delegate');
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
    h.executeAgent.running[mentionId] = ['exec-1'];
    h.setLlm(fixed([toolUse('conclude_thread', { threadId: thread.id, summary: 'Fix livré.', question: { text: 'Push ?', options: ['Push it', 'Hold'] } })]));
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'resolved' } });
    expect(thread.status).toBe('concluded');
    expect(thread.concludedBy).toBe('assistant');
    expect(h.executeAgent.cancelled).toEqual([mentionId]);
    // The assistant's own conclusion stops the run as the assistant.
    expect(h.agentEvents.stopped).toEqual([{ id: 'exec-1', by: 'assistant', reason: 'thread conclu' }]);
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

  it.each([
    ['the user stopped the run', { manuallyTerminatedByUser: true }],
    ['the run was auto-terminated at conclusion', { autoTerminatedAtConclusion: true }],
  ])('continue_thread leaves a failed thread alone when %s (no relaunch, no fight with the user)', async (_label, flags) => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })]));
    const m = h.mentions.saved[0]!; m.acknowledge(); m.markFailed(); await h.mentions.save(m);
    h.agentEvents.byMention[m.id] = flags;
    thread.fail(); await h.threads.save(thread);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'failed' } });
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.status).toBe('failed');
  });

  describe('relaying a screenshot to an agent (the assistant retypes the /api/files uuid by hand)', () => {
    const REAL = '9a822289-c6a3-4c70-8f13-064ed046e9a6';
    const TYPO = '9a822289-c6a3-4c70-8f13-064ed046e9c6'; // last block retyped wrongly, as seen in production
    const withScreenshot = async (turn: string) => {
      const h = harness([{ tools: [{ name: 'delegate', input: { targetType: 'agent', name: 'builder', brief: 'A', turn } }] }, { text: '' }]);
      h.comments.saved.push(TicketCommentEntity.create({ id: 'c0', ticketId: 't1', authorType: 'user', authorName: 'Nas', body: `cassé ![image.png](/api/files/${REAL})` }));
      await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
      return h;
    };

    it('a slightly wrong id is corrected to the attachment the user sent, so the agent gets the image', async () => {
      const h = await withScreenshot(`regarde ![image.png](/api/files/${TYPO})`);
      const relayed = h.comments.saved.find((c) => c.threadId)!;
      expect(relayed.body).toContain(`/api/files/${REAL}`);
      expect(relayed.body).not.toContain(TYPO);
    });

    it('an id matching nothing on the ticket sends nothing and tells the model the valid ids', async () => {
      const h = await withScreenshot('regarde ![image.png](/api/files/00000000-1111-2222-3333-444444444444)');
      expect(h.comments.saved.some((c) => c.threadId)).toBe(false);
      expect(h.threads.saved.size).toBe(0);
      const results = h.llmCalls.at(-1)!.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result');
      const text = JSON.stringify(results);
      expect(text).toContain("n'existe pas sur ce ticket");
      expect(text).toContain(REAL);
    });
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

// The kill switch: when the assistant misbehaves, switching it off must stop it everywhere
// (message, new ticket, thread wake-up) without a restart, and leave the ticket usable.
describe('RunAssistantTurnUseCase — workThreadsEnabled kill switch', () => {
  it('off: no turn runs — no model call, no comment, no execution log', async () => {
    const h = harness([{ text: 'Bonjour' }], { workThreadsEnabled: false });
    for (const trigger of [user('c0'), { kind: 'ticket_created' as const }, { kind: 'thread_reply' as const, threadId: 'th', mentionStatus: 'resolved' as const }]) {
      await h.uc.execute({ ticketId: 't1', trigger });
    }
    expect(h.llmCalls).toHaveLength(0);
    expect(h.comments.saved).toHaveLength(0);
    expect(h.agentEvents.executions).toHaveLength(0);
  });

  it('off: no assistant persona resolves, so the routes answer assistant: null and the composer posts plain comments', async () => {
    const h = harness([], { workThreadsEnabled: false });
    expect(await h.uc.resolveAssistantPersona(h.ticket)).toBeNull();
  });

  // Opt-in: merging the feature must change nothing until it is switched on.
  it('absent means off', async () => {
    const h = harness([{ text: 'Bonjour' }], { workThreadsEnabled: undefined });
    expect(await h.uc.resolveAssistantPersona(h.ticket)).toBeNull();
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.llmCalls).toHaveLength(0);
  });

  it('true turns it on', async () => {
    const h = harness([{ text: 'Bonjour' }], { workThreadsEnabled: true });
    expect((await h.uc.resolveAssistantPersona(h.ticket))?.id).toBe('p-nas');
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.comments.saved).toHaveLength(1);
  });
});

// The assistant persona shows in the per-persona stats like any other; that is only
// useful if its turns carry a cost — they used to be recorded at 0 $.
describe('RunAssistantTurnUseCase — cost of a turn', () => {
  it('records the turn cost from the tokens of every round (Haiku 4.5: $1 / $5 per MTok)', async () => {
    const h = harness([{ text: 'Je regarde.', tools: [{ name: 'fleex_ticket_show', input: { id: 't1' } }] }, { text: 'Fait.' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const done = h.agentEvents.completed.at(-1)!;
    expect(done.status).toBe('completed');
    // 2 rounds × (10 input + 5 output tokens) = 20 × 1e-6 + 10 × 5e-6
    expect(done.metrics).toMatchObject({ inputTokens: 20, outputTokens: 10 });
    expect(done.metrics.costUsd as number).toBeCloseTo(20 * 1e-6 + 10 * 5e-6, 12);
  });

  it('records what was billed even when the turn fails afterwards', async () => {
    const h = harness([{ text: 'x' }]);
    h.setLlm(async () => { throw new Error('overloaded'); });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const failed = h.agentEvents.completed.at(-1)!;
    expect(failed.status).toBe('failed');
    expect(failed.metrics).toHaveProperty('costUsd', 0);
  });

  it('prices cache reads and writes, and leaves an unpriced model unknown rather than free', () => {
    const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 };
    expect(assistantTurnCostUsd('claude-haiku-4-5', u)).toBeCloseTo(0.1 + 1.25, 9);
    expect(assistantTurnCostUsd('some-unknown-model', u)).toBeUndefined();
  });
});

/** Every tool result the model read back, in order (one entry per tool call). */
function toolResults(h: ReturnType<typeof harness>): string[] {
  const byCall = new Map<string, string>();
  for (const call of h.llmCalls) {
    for (const m of call.messages) {
      if (m.role !== 'user' || !Array.isArray(m.content)) continue;
      for (const b of m.content) if (b.type === 'tool_result') byCall.set(b.tool_use_id, String(b.content));
    }
  }
  return [...byCall.values()];
}
const wake = (threadId: string) => ({ kind: 'thread_reply' as const, threadId, mentionStatus: 'resolved' as const });
const pause = () => new Promise((r) => setTimeout(r, 5));

// Lot 2 — principle 1: a human action is never undone by the assistant without a new human message.
// The guarantees are in the server: the scripted model below always TRIES to relaunch.
describe("RunAssistantTurnUseCase — the human's actions win", () => {
  /** A builder thread whose run was stopped through the real stop path by `by`, then `rounds` for the next turns. */
  async function stoppedThread(by: 'user' | 'assistant', rounds: Round[]) {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }, ...rounds]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    h.executeAgent.running[m.id] = ['exec-1'];
    await h.stopRun.stopThread(thread, { by, reason: 'stop' });
    return { h, thread };
  }
  const userSays = async (h: ReturnType<typeof harness>, id: string, body: string) => {
    await pause();
    await h.comments.save(TicketCommentEntity.create({ id, ticketId: 't1', authorType: 'user', authorName: 'Olivier', body }));
    await pause();
    return user(id);
  };

  it('on a wake-up, continue_thread to a target the user stopped is refused, and says why', async () => {
    const { h, thread } = await stoppedThread('user', []);
    const events: unknown[] = [];
    h.setLlm(async (p, onText) => {
      const tr = p.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_result');
      if (tr) { events.push(tr); onText('ok'); return { content: [textBlock('ok')], stopReason: 'end_turn' }; }
      return { content: [toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })], stopReason: 'tool_use' };
    });
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.status).toBe('idle');
    expect(thread.userHoldAt).toBeInstanceOf(Date);
    expect(h.executeAgent.woken).toEqual([]);
    expect(events).toHaveLength(1);
    const refusal = String((events[0] as { content: string }).content);
    expect(refusal).toMatch(/^Refusé/);
    expect(refusal).toContain("l'utilisateur a arrêté builder");
    expect(refusal).toContain('Relancer');
    expect((events[0] as { is_error?: boolean }).is_error).toBe(false);
  });

  it('on a wake-up, delegate to the same target is refused too: no second thread, no mention', async () => {
    const { h, thread } = await stoppedThread('user', [{ tools: [delegateBuilder] }, { text: 'ok' }]);
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.threads.saved.size).toBe(1);
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.userHoldAt).toBeInstanceOf(Date);
    expect(toolResults(h).at(-1)).toContain("l'utilisateur a arrêté builder");
  });

  it('a user message posted after the stop lifts the hold for that turn: the relaunch goes through', async () => {
    const { h, thread } = await stoppedThread('user', []);
    const trigger = await userSays(h, 'c-resume', 'reprends');
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })]));
    await h.uc.execute({ ticketId: 't1', trigger });
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.status).toBe('running');
    expect(thread.userHoldAt).toBeNull();
    expect(thread.lastStop).toBeNull();
  });

  it('a user message posted BEFORE the stop does not: a turn that was already queued cannot undo the stop', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const trigger = await (async () => {
      await h.comments.save(TicketCommentEntity.create({ id: 'c-early', ticketId: 't1', authorType: 'user', authorName: 'Olivier', body: 'et ajoute des tests' }));
      await pause();
      return user('c-early');
    })();
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    h.executeAgent.running[m.id] = ['exec-1'];
    await h.stopRun.stopThread(thread, { by: 'user' });
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'ajoute des tests' })]));
    await h.uc.execute({ ticketId: 't1', trigger });
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.userHoldAt).toBeInstanceOf(Date);
  });

  it('a later user message that does not lead to a relaunch leaves the hold in place for the next wake-up', async () => {
    const { h, thread } = await stoppedThread('user', [{ text: 'Il est arrêté, je ne touche à rien.' }]);
    const trigger = await userSays(h, 'c-ask', 'où en est-on ?');
    await h.uc.execute({ ticketId: 't1', trigger });
    expect(thread.userHoldAt).toBeInstanceOf(Date);
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(1);
  });

  it('« Relancer » is a human request for that thread: the relaunch goes through', async () => {
    const { h, thread } = await stoppedThread('user', []);
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })]));
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'relaunch_request', threadId: thread.id } });
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.status).toBe('running');
    expect(thread.userHoldAt).toBeNull();
  });

  it('a run the assistant stopped itself is not held: it relaunches freely on a wake-up', async () => {
    const { h, thread } = await stoppedThread('assistant', []);
    expect(thread.userHoldAt).toBeNull();
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.status).toBe('running');
  });

  it('the assistant reads who stopped the last run, and when, in the thread list of its prompt', async () => {
    const { h, thread } = await stoppedThread('user', [{ text: 'ok' }]);
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    const prompt = String(h.llmCalls.at(-1)!.messages[0]!.content);
    expect(prompt).toMatch(/dernier run arrêté par l'utilisateur à \d{2}:\d{2} \[\d{4}-\d{2}-\d{2}T/);
    expect(prompt).toContain('BLOCAGE UTILISATEUR');
  });

  it.each(['done', 'cancelled'] as const)('ticket moved to %s: on a wake-up the assistant may only conclude — launches are refused', async (status) => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const m = h.mentions.saved[0]!; m.acknowledge(); m.resolve(); await h.mentions.save(m);
    thread.markIdle();
    h.ticket.status = status;

    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'encore' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(1);
    h.setLlm(fixed([toolUse('delegate', { targetType: 'agent', name: 'nas', brief: 'B', turn: 'autre' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.threads.saved.size).toBe(1);

    // Concluding stays possible…
    h.setLlm(fixed([toolUse('conclude_thread', { threadId: thread.id, summary: 'Clos avec le ticket.' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(thread.status).toBe('concluded');
  });

  it('ticket done: a new user message can still ask for work', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    h.ticket.status = 'done';
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.threads.saved.size).toBe(1);
    expect(h.mentions.saved).toHaveLength(1);
  });

  it('a thread the human concluded: concluded by the user, its run stopped as the user, and not reopened on a wake-up', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    h.executeAgent.running[m.id] = ['exec-1'];
    h.setLlm(fixed([toolUse('conclude_thread', { threadId: thread.id, summary: 'Stop.' })]));
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: thread.id } });
    expect(thread.status).toBe('concluded');
    expect(thread.concludedBy).toBe('user');
    expect(h.agentEvents.stopped).toEqual([{ id: 'exec-1', by: 'user', reason: 'thread conclu' }]);

    // Another thread wakes the assistant, which tries to hand the same target new work.
    h.setLlm(fixed([toolUse('delegate', { targetType: 'agent', name: 'builder', brief: 'B', turn: 'recommence' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake('other-thread') });
    expect(h.threads.saved.size).toBe(1);
    expect(h.mentions.saved).toHaveLength(1);

    // The human asks again: a new thread opens.
    const trigger = await userSays(h, 'c-again', 'relance le builder');
    await h.uc.execute({ ticketId: 't1', trigger });
    expect(h.threads.saved.size).toBe(2);
  });

  it('a thread the assistant concluded itself can be reopened on a wake-up', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    h.setLlm(fixed([toolUse('conclude_thread', { threadId: thread.id, summary: 'Fini.' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    h.setLlm(fixed([toolUse('delegate', { targetType: 'agent', name: 'builder', brief: 'B', turn: 'la suite' })]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.threads.saved.size).toBe(2);
  });
});

// Lot 1 — stop a run without closing its thread, and redirect it.
describe('RunAssistantTurnUseCase — stop_thread and continue_thread(interrupt)', () => {
  const review = { id: 'w-review', slug: 'review', name: 'Review', description: 'Relit', enabled: true };

  /**
   * A builder thread whose first turn is executing (`exec-1`, started 65 s ago),
   * with the real thread listener on the bus: `wakeUps` is every assistant turn
   * an event would have triggered.
   */
  async function runningThread(rounds: Round[]) {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }, ...rounds]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    h.executeAgent.running[m.id] = ['exec-1'];
    h.agentEvents.startedAt['exec-1'] = new Date(Date.now() - 65_000).toISOString();
    const wakeUps: unknown[] = [];
    new AssistantThreadListener({
      eventBus: h.eventBus, threadStore: h.threads as never, commentStore: h.comments as never,
      runAssistantTurn: { execute: async (p: unknown) => { wakeUps.push(p); } } as never, logger: logger as never,
    }).register();
    // What the UI is told, in order: the status carried by each thread.updated.
    const statuses: string[] = [];
    h.eventBus.on('thread.updated', () => { statuses.push(thread.status); });
    return { h, thread, mention: m, wakeUps, statuses };
  }
  const threadBodies = (h: ReturnType<typeof harness>, threadId: string) => h.comments.saved.filter((c) => c.threadId === threadId).map((c) => c.body);

  it('stop_thread stops the run as the assistant: thread idle and open, failures unchanged, a line in the thread, no wake-up', async () => {
    const { h, thread, mention, wakeUps } = await runningThread([]);
    thread.fail(); thread.markRunning(); // one earlier failure: the stop must not add to it
    const rounds = h.llmCalls.length;
    h.setLlm(async (p, onText) => {
      const answered = p.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'));
      h.llmCalls.push({ system: p.system, tools: p.tools.map((t) => t.name), messages: p.messages });
      if (answered) { onText("J'ai arrêté The Builder."); return { content: [textBlock("J'ai arrêté The Builder.")], stopReason: 'end_turn' }; }
      return { content: [toolUse('stop_thread', { threadId: thread.id, reason: 'plus de migration, voir @agent:builder' }, 'tu-stop')], stopReason: 'tool_use' };
    });
    const t0 = Date.now();
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    await pause();
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(h.llmCalls.length).toBe(rounds + 2);

    expect(h.agentEvents.stopped).toEqual([{ id: 'exec-1', by: 'assistant', reason: 'plus de migration, voir @agent:builder' }]);
    expect(h.executeAgent.running[mention.id]).toEqual([]);
    expect(thread.status).toBe('idle');
    expect(thread.isTerminal).toBe(false);
    expect(thread.failures).toBe(1);
    expect(thread.userHoldAt).toBeNull();
    expect(thread.lastStop).toMatchObject({ by: 'assistant' });
    // Not a failure for anyone: the mention is closed, never failed.
    expect(mention.status).toBe('resolved');
    expect(h.emitted).not.toContain('mention.execution_failed');
    // The stop itself triggers no assistant turn.
    expect(wakeUps).toEqual([]);
    // « Run arrêté par <assistant> : <reason> », in the thread — and its tag launches nobody.
    expect(threadBodies(h, thread.id).at(-1)).toBe('Run arrêté par Nas : plus de migration, voir @agent:builder');
    expect(h.mentions.saved).toHaveLength(1);
    // The model is told what was running and for how long.
    const result = toolResults(h).at(-1)!;
    expect(result).toContain("l'agent The Builder");
    expect(result).toMatch(/une exécution tournait depuis 1 min 0\d s/);
    expect(result).toContain('Le thread reste ouvert (idle)');
    // And the user reads the one-sentence announcement.
    expect(h.comments.saved.at(-1)).toMatchObject({ threadId: null, body: "J'ai arrêté The Builder." });
  });

  it('continue_thread with interrupt: the run is stopped, THEN the new turn opens a mention in the same thread', async () => {
    const { h, thread, mention, wakeUps, statuses } = await runningThread([]);
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'Pas de migration : fais-le en config. Vérifie le worktree.', interrupt: true })]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    await pause();

    expect(h.agentEvents.stopped).toEqual([{ id: 'exec-1', by: 'assistant', reason: 'remplacé par une nouvelle consigne' }]);
    expect(mention.status).toBe('resolved');
    // In that order, in one call: idle (stopped), then running (new turn).
    expect(statuses.slice(0, 2)).toEqual(['idle', 'running']);
    expect(threadBodies(h, thread.id).slice(-2)).toEqual([
      'Run arrêté par Nas : remplacé par une nouvelle consigne',
      '@agent:builder Pas de migration : fais-le en config. Vérifie le worktree.',
    ]);
    expect(h.threads.saved.size).toBe(1);
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.currentMentionId).toBe(h.mentions.saved[1]!.id);
    expect(thread.status).toBe('running');
    expect(thread.failures).toBe(0);
    expect(wakeUps).toEqual([]);
  });

  it('interrupt tells the model both halves: what was stopped, and that the new turn went out', async () => {
    const { h, thread } = await runningThread([]);
    h.setLlm(async (p, onText) => {
      h.llmCalls.push({ system: p.system, tools: [], messages: p.messages });
      if (p.messages.length > 1) { onText('ok'); return { content: [textBlock('ok')], stopReason: 'end_turn' }; }
      return { content: [toolUse('continue_thread', { threadId: thread.id, turn: 'nouvelle consigne', interrupt: true }, 'tu-int')], stopReason: 'tool_use' };
    });
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    const result = toolResults(h).at(-1)!;
    expect(result.indexOf('Arrêté — ')).toBe(0);
    expect(result).toContain('Nouveau tour envoyé à builder');
    expect(result.indexOf('Arrêté')).toBeLessThan(result.indexOf('Nouveau tour envoyé'));
  });

  it('without interrupt a running thread is still left alone: nothing stopped, nothing sent', async () => {
    const { h, thread, mention } = await runningThread([]);
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'et aussi…' })]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.agentEvents.stopped).toEqual([]);
    expect(h.executeAgent.running[mention.id]).toEqual(['exec-1']);
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.status).toBe('running');
  });

  it('interrupt must be strictly true: a loose value never stops a run', async () => {
    const { h, thread } = await runningThread([]);
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'x', interrupt: 'true' })]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.agentEvents.stopped).toEqual([]);
    expect(h.mentions.saved).toHaveLength(1);
  });

  it('interrupt on a thread where nothing runs just sends the turn, with no stop line', async () => {
    const { h, thread, mention } = await runningThread([]);
    h.executeAgent.running[mention.id] = [];
    mention.resolve(); thread.markIdle();
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'la suite', interrupt: true })]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.mentions.saved).toHaveLength(2);
    expect(threadBodies(h, thread.id).some((b) => b.startsWith('Run arrêté par'))).toBe(false);
    expect(h.agentEvents.stopped).toEqual([]);
  });

  it('stop_thread when nothing runs says so and changes nothing', async () => {
    const { h, thread, mention } = await runningThread([]);
    h.executeAgent.running[mention.id] = [];
    mention.resolve(); thread.markIdle();
    const before = h.comments.saved.length;
    h.setLlm(fixed([toolUse('stop_thread', { threadId: thread.id, reason: 'au cas où' })]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(thread.lastStop).toBeNull();
    expect(h.comments.saved.slice(before).filter((c) => c.threadId === thread.id)).toEqual([]);
  });

  it('a turn still queued is cancelled, and the result says it never started', async () => {
    const { h, thread, mention } = await runningThread([]);
    h.executeAgent.running[mention.id] = [];
    h.setLlm(async (p, onText) => {
      h.llmCalls.push({ system: p.system, tools: [], messages: p.messages });
      if (p.messages.length > 1) { onText('ok'); return { content: [textBlock('ok')], stopReason: 'end_turn' }; }
      return { content: [toolUse('stop_thread', { threadId: thread.id, reason: 'inutile' }, 'tu-q')], stopReason: 'tool_use' };
    });
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(mention.status).toBe('resolved');
    expect(thread.status).toBe('idle');
    expect(toolResults(h).at(-1)).toContain("n'avait pas démarré");
  });

  it('stop_thread without a reason is refused as invalid, and stops nothing', async () => {
    const { h, thread, mention } = await runningThread([]);
    h.setLlm(fixed([toolUse('stop_thread', { threadId: thread.id })]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.executeAgent.running[mention.id]).toEqual(['exec-1']);
    expect(thread.status).toBe('running');
  });

  describe('on a workflow thread', () => {
    async function workflowThread() {
      const h = harness([{ tools: [{ name: 'delegate', input: { targetType: 'workflow', name: 'review', brief: 'x', turn: 'y' } }] }, { text: '' }], { workflows: [review], runs: [] });
      await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
      const thread = [...h.threads.saved.values()][0]!;
      h.mentions.saved[0]!.resolve(); // a workflow mention settles as soon as its run starts
      const live = run('r1', `mention:${thread.currentMentionId}`, 'running');
      (h as unknown as { uc: { deps: { workflowRunStore: { getByTicket(): Promise<unknown[]> } } } }).uc.deps.workflowRunStore.getByTicket = async () => [live];
      (h as unknown as { stopRun: { deps: { workflowRunStore: { getByTicket(): Promise<unknown[]> } } } }).stopRun.deps.workflowRunStore.getByTicket = async () => [live];
      h.stopRun.cancelWorkflowRun = { execute: async (runId: string, stop?: { by: string; reason?: string | null }) => { h.workflowCancels.push({ runId, ...stop }); live.status = 'cancelled'; } } as never;
      return { h, thread, live };
    }

    it('stop_thread cancels the run through CancelWorkflowRunUseCase as the assistant; the thread stays open', async () => {
      const { h, thread, live } = await workflowThread();
      h.setLlm(fixed([toolUse('stop_thread', { threadId: thread.id, reason: 'mauvais workflow' })]));
      await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
      expect(h.workflowCancels).toEqual([{ runId: 'r1', by: 'assistant', reason: 'mauvais workflow' }]);
      expect(live.status).toBe('cancelled');
      expect(thread.status).toBe('idle');
      expect(thread.isTerminal).toBe(false);
      expect(thread.failures).toBe(0);
      expect(threadBodies(h, thread.id).at(-1)).toBe('Run arrêté par Nas : mauvais workflow');
    });

    it('interrupt cancels the run, then starts a new one from the new turn', async () => {
      const { h, thread } = await workflowThread();
      h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'sur la branche main', interrupt: true })]));
      await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
      expect(h.workflowCancels.map((c) => c.by)).toEqual(['assistant']);
      expect(h.mentions.saved).toHaveLength(2);
      expect(h.mentions.saved[1]).toMatchObject({ targetType: 'workflow', targetAgent: 'review' });
      expect(thread.status).toBe('running');
    });

    it('a target that cannot be stopped is said so — the tool does not fail silently, and interrupt sends nothing', async () => {
      const { h, thread, live } = await workflowThread();
      h.stopRun.cancelWorkflowRun = null;
      h.setLlm(async (p, onText) => {
        h.llmCalls.push({ system: p.system, tools: [], messages: p.messages });
        if (p.messages.length > 1) { onText('ok'); return { content: [textBlock('ok')], stopReason: 'end_turn' }; }
        return { content: [toolUse('continue_thread', { threadId: thread.id, turn: 'x', interrupt: true }, 'tu-u')], stopReason: 'tool_use' };
      });
      await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
      expect(toolResults(h).at(-1)).toMatch(/^Impossible d'arrêter le workflow Review/);
      expect(live.status).toBe('running');
      expect(h.mentions.saved).toHaveLength(1);
      expect(thread.status).toBe('running');
    });
  });
});
