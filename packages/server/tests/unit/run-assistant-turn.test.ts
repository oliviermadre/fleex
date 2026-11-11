import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { RunAssistantTurnUseCase, assistantTurnCostUsd, ASSISTANT_MAX_ROUNDS, MAX_ASSISTANT_TURNS_PER_THREAD, MAX_LAUNCHES_PER_TURN, MAX_RUNNING_THREADS_PER_TICKET } from '../../src/application/use-cases/run-assistant-turn.js';
import { StopRunUseCase } from '../../src/application/use-cases/stop-run.js';
import { SubmitDeliverableUseCase } from '../../src/application/use-cases/submit-deliverable.js';
import type { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import type { AssistantLlm, AssistantUsage } from '../../src/application/assistant/assistant-llm.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { AssistantThreadListener } from '../../src/application/assistant-thread-listener.js';
import { EventBus } from '../../src/application/event-bus.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { AssistantWorkspacePort } from '../../src/application/assistant/workspace-tools.js';
import type { CliTool } from '../../src/application/assistant/fleex-cli-tools.js';
import { extractRequestedTargets, ORIGINAL_MESSAGE_HEADER } from '../../src/application/assistant/assistant-protocol.js';

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
class FakeDeliverableStore {
  saved: TicketDeliverableEntity[] = [];
  async getByTicket(ticketId: string) { return this.saved.filter((d) => d.ticketId === ticketId); }
  async save(d: TicketDeliverableEntity) { if (!this.saved.includes(d)) this.saved.push(d); }
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
  /** Finished executions of the ticket with what they cost (null = unknown), for the cost line of the prompt. */
  costs: Array<{ status: string; costUsd: number | null }> = [];
  async getExecutionsByTicket() { return [...Object.entries(this.startedAt).map(([id, startedAt]) => ({ id, startedAt })), ...this.costs]; }
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

const DISPLAY: Record<string, string> = { nas: 'Nas', builder: 'The Builder' };
function persona(name: string, executionMode?: 'message') {
  return AgentPersonaEntity.create({ id: `p-${name}`, name, displayName: DISPLAY[name] ?? name, model: 'claude-haiku-4-5-20251001', ...(executionMode ? { executionMode } : {}) });
}

type Round = { text?: string; tools?: Array<{ name: string; input: Record<string, unknown> }>; usage?: AssistantUsage };

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

/** Answers once with the given content, then with nothing: one scripted round followed by the end of the turn. */
function fixedOnce(content: Anthropic.ContentBlock[]): AssistantLlm {
  let done = false;
  return async () => {
    if (done) return { content: [], stopReason: 'end_turn' };
    done = true;
    return { content, stopReason: 'tool_use' };
  };
}
/**
 * The same tool calls at the start of EVERY turn, then the end of the turn —
 * recorded in `calls` like the harness LLM does, each call with its own id, so
 * the tool results can be read back.
 */
function eachTurn(calls: Array<{ messages: Anthropic.MessageParam[] }>, tools: Array<{ name: string; input: Record<string, unknown> }>): AssistantLlm {
  let n = 0;
  return async (p) => {
    (calls as unknown[]).push({ model: p.model, thinking: p.thinking, system: p.system, tools: [], messages: p.messages });
    const fresh = p.messages.length === 1;
    n += 1;
    return fresh
      ? { content: tools.map((t, i) => toolUse(t.name, t.input, `et-${n}-${i}`)), stopReason: 'tool_use' }
      : { content: [], stopReason: 'end_turn' };
  };
}
/** Every tool result of the conversation a model call belongs to, in order (the messages array is shared by the rounds of a turn). */
function resultBlocks(h: { llmCalls: Array<{ messages: Anthropic.MessageParam[] }> }, call: number): Anthropic.ToolResultBlockParam[] {
  return h.llmCalls[call]!.messages.flatMap((m) => (m.role === 'user' && Array.isArray(m.content) ? m.content : []))
    .filter((b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result');
}

/** Scripts the model: each round returns text and/or tool calls; text is streamed char-by-char. */
interface Catalogue {
  extraCliTools?: CliTool[];
  skills?: Array<{ id: string; commandName: string; name: string; displayName: string; markdownContent: string; enabled: boolean }>;
  workflows?: Array<{ id: string; slug: string; name: string; description: string; enabled: boolean }>;
  runs?: Array<{ id: string; ticketId: string; triggeredFrom: string; status: string; startedAt: Date; isActive(): boolean }>;
  deliverables?: Array<Record<string, unknown>>;
  /** Personas besides the assistant (nas) and builder. */
  extraPersonas?: AgentPersonaEntity[];
  /** The « agents see the todo » setting (absent = off, like the real default). */
  todoAgentAccess?: boolean;
  /** The ticket's todo items, as the ticket context carries them. */
  todos?: Array<Record<string, unknown>>;
  /** The assistant's own hands (Read / Write / Edit / Bash); absent, they are not offered. */
  workspace?: AssistantWorkspacePort;
  /** Files uploaded in the discussion, by id. */
  attachments?: Record<string, { name: string; mimeType: string; buffer: Buffer }>;
  /** What the CLI answers (default: a ticket, ok). */
  cliResult?: (argv: string[]) => { ok: boolean; text: string };
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
  const personas = [persona('nas'), persona('builder'), ...(opts.extraPersonas ?? [])];
  const comments = new FakeCommentStore();
  const mentions = new FakeMentionStore();
  const threads = new FakeThreadStore();
  const agentEvents = new FakeAgentEventStore();
  const eventBus = new EventBus();
  const executeAgent = new FakeExecuteAgent(agentEvents, mentions, eventBus);
  const emitted: string[] = [];
  eventBus.on('*', (e) => { emitted.push(e.type); });
  const deliverables = new FakeDeliverableStore();
  const config = { get: () => ({ basePath: '', defaultShell: '', repositoryRefreshIntervalMs: 0, workThreadsEnabled: 'workThreadsEnabled' in opts ? opts.workThreadsEnabled : true, todoAgentAccess: opts.todoAgentAccess }) };
  const postComment = new PostCommentUseCase(comments as never, mentions as never, { saveActivity: async () => {} } as never, logger as never);
  const llmCalls: Array<{ model: string; thinking: boolean | undefined; system: string; tools: string[]; messages: Anthropic.MessageParam[] }> = [];
  const cliCalls: string[][] = [];
  /** Who each CLI call was made as (the identity `runCli` received), in call order. */
  const cliActors: unknown[] = [];
  let n = 0;
  const llm: AssistantLlm = async (params, onText) => {
    llmCalls.push({ model: params.model, thinking: params.thinking, system: params.system, tools: params.tools.map((t) => t.name), messages: params.messages });
    const r = rounds[n++] ?? { text: '' };
    if (r.text) for (const ch of r.text) onText(ch);
    const content: Anthropic.ContentBlock[] = [];
    if (r.text) content.push(textBlock(r.text));
    for (const [i, t] of (r.tools ?? []).entries()) content.push(toolUse(t.name, t.input, `tu-${n}-${i}`));
    return { content, stopReason: r.tools?.length ? 'tool_use' : 'end_turn', usage: r.usage ?? { inputTokens: 10, outputTokens: 5 } };
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
        mentions: { pending: [], all: mentions.saved.map((m) => m.toDTO()) }, deliverables: [...(opts.deliverables ?? []), ...deliverables.saved.map((d) => d.toDTO())], activity: [], relevantSummaries: [], epics: [], memorySnippets: [],
        ...(opts.todos ? { todos: opts.todos } : {}),
      }),
    } as never,
    agentEventStore: agentEvents as never, executeAgent: executeAgent as never, stopRun,
    // The real use case on a fake store: the mandate is written the way production writes a deliverable.
    deliverableStore: deliverables as never,
    submitDeliverable: new SubmitDeliverableUseCase(deliverables as never, { saveActivity: async () => {} } as never, config as never, logger as never),
    config: config as never,
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
    workspace: opts.workspace,
    attachments: opts.attachments ? { load: async (id: string) => opts.attachments![id] ?? null } : undefined,
    environment: {
      workspace: 'qa', cliBin: '/opt/fleex', hasApiKey: opts.hasApiKey ?? true,
      cliTools: async () => [showTool, ...(opts.extraCliTools ?? [])],
      runCli: async (argv: string[], actor?: unknown) => {
        cliCalls.push(argv); cliActors.push(actor);
        return opts.cliResult?.(argv) ?? { ok: true, text: '{"id":"t1","title":"e2e rouges"}' };
      },
    },
  }, llm);
  const setLlm = (next: AssistantLlm) => { (uc as unknown as { llm: AssistantLlm }).llm = next; };
  return { uc, ticket, comments, mentions, threads, deliverables, agentEvents, executeAgent, eventBus, stopRun, workflowCancels, emitted, llmCalls, cliCalls, cliActors, setLlm };
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
    expect(call.system.length).toBeLessThan(18000); // rules only: no CLI help, no ticket content
    expect(call.tools).toEqual(['delegate', 'continue_thread', 'stop_thread', 'conclude_thread', 'request_mode', 'propose_mandate', 'confirm_mandate', 'note_decision', 'ask_user', 'fleex_ticket_show']);
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

  it('a second launch on the same thread in the same turn is refused, and says why', async () => {
    const h = harness([{ tools: [delegateBuilder, { name: 'delegate', input: { targetType: 'agent', name: 'builder', brief: 'B', turn: 'deux' } }] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.threads.saved.size).toBe(1);
    expect(h.mentions.saved).toHaveLength(1);
    const results = h.llmCalls[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    // A refusal is a result the model reads (like the human-hold refusals), not a tool error.
    expect(String(results[0]!.content)).not.toMatch(/^Refusé/);
    expect(results[1]!.content).toMatch(/^Refusé.*une seule action de lancement par thread et par tour/);
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

// Lot 5 — an orchestrator, not an executor.
describe('RunAssistantTurnUseCase — the assistant runs on its own model', () => {
  it("a ticket's model and effort overrides do not reach the assistant turn: it runs on its persona's model", async () => {
    const h = harness([{ text: 'ok' }]);
    h.ticket.updateExecutionConfig({ modelOverride: 'claude-opus-4-8', effortOverride: 'max' });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.llmCalls[0]!.model).toBe('claude-haiku-4-5-20251001');
    expect((h.agentEvents.executions[0] as { model: string }).model).toBe('claude-haiku-4-5-20251001');
    expect(h.agentEvents.completed.at(-1)!.metrics.model).toBe('claude-haiku-4-5-20251001');
    // The override is untouched: it still applies to the agents the assistant delegates to.
    expect(h.ticket.modelOverride).toBe('claude-opus-4-8');
  });

  it('the cache tokens the model reports on the second round are accounted and priced (Haiku 4.5: read ×0.1, write ×1.25)', async () => {
    const h = harness([
      { tools: [{ name: 'fleex_ticket_show', input: { id: 't1' } }], usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 5000 } },
      { text: 'Fait.', usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 5000, cacheCreationTokens: 200 } },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const m = h.agentEvents.completed.at(-1)!.metrics;
    expect(m).toMatchObject({ inputTokens: 150, outputTokens: 30, cacheReadTokens: 5000, cacheCreationTokens: 5200 });
    expect(m.costUsd as number).toBeCloseTo(150 * 1e-6 + 30 * 5e-6 + 5000 * 0.1e-6 + 5200 * 1.25e-6, 12);
  });
});

describe('RunAssistantTurnUseCase — thinking on decision turns', () => {
  it('a user message with no open thread is not a decision turn', async () => {
    const h = harness([{ text: 'ok' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.llmCalls[0]!.thinking).toBe(false);
  });

  it('a user message received while a thread is open is one, on every round of the turn', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }, { tools: [{ name: 'fleex_ticket_show', input: { id: 't1' } }] }, { text: 'ok' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.llmCalls.map((c) => c.thinking)).toEqual([false, false, true, true]);
  });

  it('a thread wake-up is one; a concluded thread no longer makes a user message one', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    h.setLlm(async (p) => { h.llmCalls.push({ model: p.model, thinking: p.thinking, system: p.system, tools: [], messages: p.messages }); return { content: [toolUse('conclude_thread', { threadId: thread.id, summary: 'ok' })], stopReason: 'tool_use' }; });
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.llmCalls[2]!.thinking).toBe(true);
    expect(thread.status).toBe('concluded');
    await h.uc.execute({ ticketId: 't1', trigger: user('c2') });
    expect(h.llmCalls.at(-1)!.thinking).toBe(false);
  });
});

describe('RunAssistantTurnUseCase — several thread actions in one turn', () => {
  const catalyst = () => persona('catalyst');
  const delegateTo = (name: string, turn = 'go') => ({ name: 'delegate', input: { targetType: 'agent', name, brief: `brief ${name}`, turn } });
  const lastResults = resultBlocks;
  const byTarget = (h: ReturnType<typeof harness>, name: string) => [...h.threads.saved.values()].find((t) => t.personaName === name);

  it('the round and turn caps of the spec', () => {
    expect(ASSISTANT_MAX_ROUNDS).toBe(16);
    expect(MAX_ASSISTANT_TURNS_PER_THREAD).toBe(20);
    expect(MAX_LAUNCHES_PER_TURN).toBe(3);
    expect(MAX_RUNNING_THREADS_PER_TICKET).toBe(3);
  });

  // Acceptance criterion « spec puis build ».
  it('spec then build: on the wake-up of the spec thread, ONE turn concludes it and opens the build thread, with no human message', async () => {
    const h = harness([{ tools: [delegateTo('catalyst', 'Spécifie X')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const spec = byTarget(h, 'catalyst')!;
    const m = h.mentions.saved[0]!; m.acknowledge(); m.resolve(); await h.mentions.save(m);
    spec.markIdle(); await h.threads.save(spec);
    const before = h.llmCalls.length;
    const rounds: Round[] = [
      { tools: [{ name: 'conclude_thread', input: { threadId: spec.id, summary: 'Spec livrée.' } }] },
      { tools: [delegateTo('builder', 'Construis X selon la spec')] },
      { text: '' },
    ];
    let n = 0;
    h.setLlm(async (p) => {
      h.llmCalls.push({ model: p.model, thinking: p.thinking, system: p.system, tools: [], messages: p.messages });
      const r = rounds[n++]!;
      return { content: (r.tools ?? []).map((t, i) => toolUse(t.name, t.input, `w-${n}-${i}`)), stopReason: r.tools ? 'tool_use' : 'end_turn' };
    });
    await h.uc.execute({ ticketId: 't1', trigger: wake(spec.id) });

    expect(spec.status).toBe('concluded');
    const build = byTarget(h, 'builder')!;
    expect(build.status).toBe('running');
    expect(h.mentions.saved.at(-1)).toMatchObject({ targetAgent: 'builder', id: build.currentMentionId });
    expect(h.comments.saved.at(-1)!.body).toBe('@agent:builder Construis X selon la spec');
    // One assistant turn did both, and no human spoke at any point.
    expect(h.agentEvents.executions).toHaveLength(2);
    expect(h.llmCalls.length - before).toBe(3);
    expect(h.comments.saved.some((c) => c.authorType === 'user')).toBe(false);
    expect(lastResults(h, before + 2).map((r) => /^Refusé/.test(String(r.content)))).toEqual([false, false]);
  });

  it('conclude A then delegate B in the same round works too', async () => {
    const h = harness([{ tools: [delegateTo('catalyst')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const spec = byTarget(h, 'catalyst')!;
    h.setLlm(fixedOnce([toolUse('conclude_thread', { threadId: spec.id, summary: 'ok' }, 'a'), toolUse('delegate', delegateTo('builder').input, 'b')]));
    await h.uc.execute({ ticketId: 't1', trigger: wake(spec.id) });
    expect(spec.status).toBe('concluded');
    expect(byTarget(h, 'builder')!.status).toBe('running');
  });

  it('delegating to two targets in one turn opens two running threads', async () => {
    const h = harness([{ tools: [delegateTo('catalyst'), delegateTo('builder')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect([...h.threads.saved.values()].map((t) => [t.personaName, t.status]).sort()).toEqual([['builder', 'running'], ['catalyst', 'running']]);
    expect(h.mentions.saved.map((m) => m.targetAgent).sort()).toEqual(['builder', 'catalyst']);
    expect(lastResults(h, 1).map((r) => /^Refusé/.test(String(r.content)))).toEqual([false, false]);
  });

  it('stop then relaunch in one turn: the run is stopped, then a new turn opens in the same thread', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = byTarget(h, 'builder')!;
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    h.executeAgent.running[m.id] = ['exec-1'];
    h.setLlm(fixedOnce([
      toolUse('stop_thread', { threadId: thread.id, reason: 'mauvaise piste' }, 'a'),
      toolUse('continue_thread', { threadId: thread.id, turn: 'repars sans migration' }, 'b'),
    ]));
    await h.comments.save(TicketCommentEntity.create({ id: 'c1', ticketId: 't1', authorType: 'user', authorName: 'Olivier', body: 'pas de migration' }));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.agentEvents.stopped).toEqual([{ id: 'exec-1', by: 'assistant', reason: 'mauvaise piste' }]);
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.status).toBe('running');
    expect(thread.currentMentionId).toBe(h.mentions.saved[1]!.id);
    expect(h.comments.saved.filter((c) => c.threadId === thread.id).map((c) => c.body)).toEqual([
      '@agent:builder un', 'Run arrêté par Nas : mauvaise piste', '@agent:builder repars sans migration',
    ]);
  });

  it('two continue_thread on the same thread in one turn: the second is refused, even across rounds', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = byTarget(h, 'builder')!;
    const m = h.mentions.saved[0]!; m.acknowledge(); m.resolve(); await h.mentions.save(m);
    thread.markIdle(); await h.threads.save(thread);
    const rounds = [
      [toolUse('continue_thread', { threadId: thread.id, turn: 'un' }, 'a')],
      [toolUse('continue_thread', { threadId: thread.id, turn: 'deux', interrupt: true }, 'b')],
      [],
    ];
    let n = 0;
    h.setLlm(async (p) => {
      h.llmCalls.push({ model: p.model, thinking: p.thinking, system: p.system, tools: [], messages: p.messages });
      const content = rounds[n++]!;
      return { content, stopReason: content.length ? 'tool_use' : 'end_turn' };
    });
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(2);
    const refusal = lastResults(h, h.llmCalls.length - 1)[1]!;
    expect(refusal.content).toMatch(/^Refusé.*une seule action de lancement par thread et par tour/);
    // The refused interrupt did not cost the run it had just launched.
    expect(h.agentEvents.stopped).toEqual([]);
    expect(thread.status).toBe('running');
  });

  it(`at most ${MAX_LAUNCHES_PER_TURN} launches per turn: the next one is refused, and opens no thread`, async () => {
    const names = ['catalyst', 'reviewer', 'scribe'];
    const h = harness([{ tools: [delegateTo('builder'), ...names.map((nm) => delegateTo(nm))] }, { text: '' }], { extraPersonas: names.map((nm) => persona(nm)) });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect([...h.threads.saved.values()].map((t) => t.personaName).sort()).toEqual(['builder', 'catalyst', 'reviewer']);
    expect(h.mentions.saved).toHaveLength(3);
    const results = lastResults(h, 1);
    expect(results.map((r) => /^Refusé/.test(String(r.content)))).toEqual([false, false, false, true]);
    expect(results[3]!.content).toMatch(/3 lancements par tour au plus/);
  });
});

describe('RunAssistantTurnUseCase — threads in parallel on one ticket', () => {
  const delegateTo = (name: string, targetType = 'agent') => ({ name: 'delegate', input: { targetType, name, brief: `brief ${name}`, turn: 'go' } });
  const results = resultBlocks;
  const lint = { id: 's-lint', commandName: 'lint', name: 'lint', displayName: 'Lint', markdownContent: 'Lint.', enabled: true };
  const fmt = { id: 's-fmt', commandName: 'fmt', name: 'fmt', displayName: 'Fmt', markdownContent: 'Format.', enabled: true };

  it(`a ticket never has more than ${MAX_RUNNING_THREADS_PER_TICKET} running threads: a later turn cannot open one more`, async () => {
    const names = ['catalyst', 'reviewer', 'scribe'];
    const h = harness([
      { tools: [delegateTo('builder'), delegateTo('catalyst'), delegateTo('reviewer')] }, { text: '' },
      { tools: [delegateTo('scribe')] }, { text: 'Trois threads tournent déjà.' },
    ], { extraPersonas: names.map((nm) => persona(nm)) });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.threads.saved.size).toBe(3);
    expect(results(h, 3)[0]!.content).toMatch(/^Refusé.*3 threads tournent déjà sur ce ticket.*3 au plus en parallèle/);

    // One of them settles: there is room again.
    const done = [...h.threads.saved.values()][0]!; done.markIdle(); await h.threads.save(done);
    h.setLlm(fixedOnce([toolUse('delegate', delegateTo('scribe').input)]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c2') });
    expect(h.threads.saved.size).toBe(4);
  });

  it('in plan mode two personas run side by side: nobody writes', async () => {
    const h = harness([{ tools: [delegateTo('builder'), delegateTo('catalyst')] }, { text: '' }], { extraPersonas: [persona('catalyst')] });
    expect(h.ticket.conversationMode).toBe('plan');
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.threads.saved.size).toBe(2);
  });

  it('in edit mode only one thread writes at a time: a second writing persona is refused while the first runs', async () => {
    const h = harness([{ tools: [delegateTo('builder'), delegateTo('catalyst')] }, { text: '' }], { extraPersonas: [persona('catalyst')] });
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect([...h.threads.saved.values()].map((t) => t.personaName)).toEqual(['builder']);
    expect(h.mentions.saved).toHaveLength(1);
    expect(results(h, 1)[1]!.content).toMatch(/^Refusé.*@agent:builder .*tourne déjà en mode edit.*un seul thread à la fois peut écrire/);

    // The writer settles: the next one may go.
    const builder = [...h.threads.saved.values()][0]!; builder.markIdle(); await h.threads.save(builder);
    h.setLlm(fixedOnce([toolUse('delegate', delegateTo('catalyst').input)]));
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.threads.saved.size).toBe(2);
  });

  it('in edit mode a message-only persona does not write: it runs beside the writer', async () => {
    const h = harness([{ tools: [delegateTo('builder'), delegateTo('advisor')] }, { text: '' }], { extraPersonas: [persona('advisor', 'message')] });
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.threads.saved.size).toBe(2);
  });

  it('a run that started in plan mode is not a writer, even if the ticket has since moved to edit', async () => {
    const h = harness([{ tools: [delegateTo('builder')] }, { text: '' }, { tools: [delegateTo('catalyst')] }, { text: '' }], { extraPersonas: [persona('catalyst')] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    // The scheduler acknowledged the mention in the mode of that moment (plan).
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    expect(m.executionMode).toBe('plan');
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    await h.uc.execute({ ticketId: 't1', trigger: user('c1') });
    expect(h.threads.saved.size).toBe(2);
  });

  it('skills always run with edit rights: two of them never run at the same time, whatever the ticket mode', async () => {
    const h = harness([{ tools: [delegateTo('lint', 'skill'), delegateTo('fmt', 'skill')] }, { text: '' }], { skills: [lint, fmt] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect([...h.threads.saved.values()].map((t) => t.personaName)).toEqual(['lint']);
    expect(results(h, 1)[1]!.content).toMatch(/@skill:lint .*tourne déjà en mode edit/);
  });
});

describe('RunAssistantTurnUseCase — the turn cap asks, it no longer concludes', () => {
  /** A builder thread that already received MAX assistant turns, its last run settled. */
  async function threadAtCap() {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const m = h.mentions.saved[0]!; m.acknowledge(); m.resolve(); await h.mentions.save(m);
    thread.markIdle(); await h.threads.save(thread);
    for (let i = 1; i < MAX_ASSISTANT_TURNS_PER_THREAD; i++) {
      await h.comments.save(TicketCommentEntity.create({ id: `turn-${i}`, ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: `relance ${i}`, threadId: thread.id }));
    }
    h.setLlm(eachTurn(h.llmCalls, [{ name: 'continue_thread', input: { threadId: thread.id, turn: 'encore' } }]));
    const questions = () => h.comments.saved.filter((c) => c.threadId === null && c.questions?.length);
    return { h, thread, questions };
  }
  const says = async (h: ReturnType<typeof harness>, id: string, body: string) => {
    await pause();
    await h.comments.save(TicketCommentEntity.create({ id, ticketId: 't1', authorType: 'user', authorName: 'Olivier', body }));
    await pause();
    return user(id);
  };

  it('one turn below the cap still goes out', async () => {
    const { h, thread } = await threadAtCap();
    h.comments.saved = h.comments.saved.filter((c) => c.id !== 'turn-1');
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.turnCap).toBeNull();
  });

  // Acceptance criterion: no launch, one question asked once, no automatic conclusion.
  it('at the cap: nothing is launched, the thread waits, ONE question with « Continuer » / « Conclure » is asked, nothing is concluded', async () => {
    const { h, thread, questions } = await threadAtCap();
    const updates: string[] = [];
    h.eventBus.on('thread.updated', () => { updates.push(thread.status); });
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });

    expect(h.mentions.saved).toHaveLength(1);
    expect(h.comments.saved.filter((c) => c.threadId === thread.id && c.body.includes('encore'))).toEqual([]);
    expect(thread.status).toBe('waiting');
    expect(thread.isTerminal).toBe(false);
    expect(thread.summary).toBeNull();
    expect(h.emitted).not.toContain('thread.concluded');
    expect(updates).toEqual(['waiting']);
    expect(questions()).toHaveLength(1);
    expect(questions()[0]!.questions![0]!.options.map((o) => (typeof o === 'string' ? o : o.label))).toEqual(['Continuer', 'Conclure']);
    expect(questions()[0]!.body).toContain('- Continuer\n- Conclure');
    expect(toolResults(h).at(-1)).toMatch(/Plafond atteint : 20 tours.*ne la repose pas/);

    // Every later attempt without the human: refused, and the question is NOT asked again.
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(questions()).toHaveLength(1);
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.status).toBe('waiting');
    expect(toolResults(h).at(-1)).toMatch(/^Refusé.*a déjà été posée à l'utilisateur/);
  });

  it('a user message from BEFORE the question does not restart the count', async () => {
    const { h, thread, questions } = await threadAtCap();
    const earlier = await says(h, 'c-early', 'vas-y');
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    await h.uc.execute({ ticketId: 't1', trigger: earlier });
    expect(h.mentions.saved).toHaveLength(1);
    expect(questions()).toHaveLength(1);
  });

  it('« Continuer » restarts the count from zero: the thread relaunches, and runs a full new allowance before asking again', async () => {
    const { h, thread, questions } = await threadAtCap();
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c-go', 'Continuer') });
    expect(h.mentions.saved).toHaveLength(2);
    expect(thread.status).toBe('running');
    expect(thread.turnCap).toEqual({ base: MAX_ASSISTANT_TURNS_PER_THREAD, askedAt: null });

    // The next wake-ups relaunch freely, without the human…
    const settle = async () => { const m = h.mentions.saved.at(-1)!; m.acknowledge(); m.resolve(); await h.mentions.save(m); thread.markIdle(); await h.threads.save(thread); };
    await settle();
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(3);
    expect(questions()).toHaveLength(1);

    // …until a full new allowance is spent: then the question comes back, once.
    await settle();
    for (let i = 0; i < MAX_ASSISTANT_TURNS_PER_THREAD - 2; i++) {
      await h.comments.save(TicketCommentEntity.create({ id: `again-${i}`, ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: `relance bis ${i}`, threadId: thread.id }));
    }
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    expect(h.mentions.saved).toHaveLength(3);
    expect(questions()).toHaveLength(2);
    expect(thread.status).toBe('waiting');
  });

  it('« Conclure » concludes: the model concludes on the human\'s word, the server still launches nothing', async () => {
    const { h, thread } = await threadAtCap();
    await h.uc.execute({ ticketId: 't1', trigger: wake(thread.id) });
    h.setLlm(fixedOnce([toolUse('conclude_thread', { threadId: thread.id, summary: 'Arrêt demandé.' })]));
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c-stop', 'Conclure') });
    expect(thread.status).toBe('concluded');
    expect(h.mentions.saved).toHaveLength(1);
  });

  it('three consecutive failures still conclude the thread (rule unchanged)', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const m = h.mentions.saved[0]!; m.acknowledge(); m.markFailed(); await h.mentions.save(m);
    thread.fail(); thread.fail(); thread.fail(); await h.threads.save(thread);
    h.setLlm(fixed([toolUse('continue_thread', { threadId: thread.id, turn: 'reprends' })]));
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'failed' } });
    expect(thread.status).toBe('concluded');
    expect(thread.summary).toMatch(/3 échecs consécutifs/);
  });
});

describe('RunAssistantTurnUseCase — a round cut by the output cap', () => {
  it('the tool call being written when the cap hit is not executed, and the model is told to redo it', async () => {
    const h = harness([]);
    let n = 0;
    h.setLlm(async (p) => {
      h.llmCalls.push({ model: p.model, thinking: p.thinking, system: p.system, tools: [], messages: p.messages });
      if (n++ === 0) return { content: [toolUse('delegate', { targetType: 'agent', name: 'builder', brief: 'A', turn: 'un brief coupé en plein mil' }, 'cut')], stopReason: 'max_tokens' };
      return { content: [textBlock('Je recommence.')], stopReason: 'end_turn' };
    });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.threads.saved.size).toBe(0);
    expect(h.mentions.saved).toHaveLength(0);
    const result = resultBlocks(h, 1)[0]!;
    expect(result).toMatchObject({ tool_use_id: 'cut', is_error: true });
    expect(result.content).toMatch(/tronqué/);
  });
});

// ── Lot 4: the todo, steered by the assistant under its own name ──
describe('RunAssistantTurnUseCase — the ticket todo', () => {
  const todoTool = (leaf: string, args: string[]): CliTool => ({
    name: `fleex_ticket_todo_${leaf}`, commandPath: ['ticket', 'todo', leaf], description: leaf, mutating: true,
    workspaceAware: true, jsonAware: true, inputSchema: { type: 'object', properties: {}, required: args },
    arguments: args.map((key) => ({ key, required: true, variadic: false })), options: [],
  });
  const todoTools = [todoTool('list', ['ticket']), todoTool('done', ['ticket', 'ref']), todoTool('add', ['ticket', 'text'])];
  const item = (ref: number, text: string, assignee: { type: 'user' | 'agent'; name: string | null } | null, state = 'open') => ({
    id: `i${ref}`, ticketId: 't1', ref, text, note: null, state, position: ref, assignee,
    createdByType: 'user', createdByName: 'olivier', createdAt: '2026-11-11T10:00:00.000Z',
    stateChangedByName: state === 'open' ? null : 'The Builder', stateChangedAt: state === 'open' ? null : '2026-11-11T11:00:00.000Z',
    assignedByName: null, takeoverReason: null, cancelReason: null,
  });
  const todos = [
    item(1, 'Écrire la spec', { type: 'agent', name: 'builder' }, 'done'),
    item(2, 'Rendre compte', { type: 'agent', name: 'nas' }),
    item(3, 'Construire', { type: 'agent', name: 'builder' }),
    item(4, 'QA manuelle', { type: 'user', name: 'olivier' }),
  ];
  const userPrompt = (h: ReturnType<typeof harness>) => h.llmCalls[0]!.messages[0]!.content as string;

  it('every CLI call is made as the assistant of THIS ticket: display name + slug, passed with the call', async () => {
    const h = harness([{ tools: [{ name: 'fleex_ticket_todo_done', input: { ticket: '1', ref: '2' } }] }, { text: 'Coché.' }],
      { todoAgentAccess: true, extraCliTools: todoTools });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.cliCalls).toEqual([['ticket', 'todo', 'done', '1', '2', '--workspace', 'qa', '--json']]);
    expect(h.cliActors).toEqual([{ name: 'Nas', persona: 'nas' }]);
  });

  it('the identity follows the assistant persona of the ticket, not a value kept from a previous turn', async () => {
    const h = harness([{ tools: [{ name: 'fleex_ticket_show', input: { id: '1' } }] }, { text: 'a' },
      { tools: [{ name: 'fleex_ticket_show', input: { id: '1' } }] }, { text: 'b' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    h.ticket.updateExecutionConfig({ assistantPersonaId: 'p-builder' });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.cliActors).toEqual([{ name: 'Nas', persona: 'nas' }, { name: 'The Builder', persona: 'builder' }]);
  });

  it('a refusal by the server (403 on the human’s item) comes back to the model as an error tool result, reason included', async () => {
    const refusal = '#4 is assigned to olivier — leave it.';
    const h = harness([{ tools: [{ name: 'fleex_ticket_todo_done', input: { ticket: '1', ref: '4' } }] }, { text: 'La QA te revient.' }],
      { todoAgentAccess: true, extraCliTools: todoTools, cliResult: () => ({ ok: false, text: `{"results":[],"failures":["#4: ${refusal}"]}` }) });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const [result] = resultBlocks(h, 1);
    expect(result!.is_error).toBe(true);
    expect(result!.content).toContain(refusal);
  });

  it('the prompt carries the todo, grouped from the assistant’s point of view', async () => {
    const h = harness([{ text: 'ok' }], { todoAgentAccess: true, extraCliTools: todoTools, todos });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const prompt = userPrompt(h);
    expect(prompt).toContain('## Todo list');
    const forMe = prompt.indexOf('### For you (nas)');
    const other = prompt.indexOf('### Assigned to another agent');
    const human = prompt.indexOf('### Assigned to olivier — do NOT act on these');
    const done = prompt.indexOf('### Done');
    expect(forMe).toBeGreaterThan(-1);
    expect([forMe, other, human, done]).toEqual([forMe, other, human, done].slice().sort((a, b) => a - b));
    // Its own item is under « For you », the builder's under « another agent », the human's under theirs.
    expect(prompt.slice(forMe, other)).toContain('#2 Rendre compte');
    expect(prompt.slice(other, human)).toContain('#3 Construire');
    expect(prompt.slice(other, human)).toContain('→ builder');
    expect(prompt.slice(human, done)).toContain('#4 QA manuelle');
    expect(prompt.slice(done)).toContain('[x] #1 Écrire la spec');
    // The todo is context, the trigger still closes the prompt.
    expect(prompt.indexOf('## Déclencheur')).toBeGreaterThan(done);
    expect(h.llmCalls[0]!.system).toContain('## La todo du ticket');
    expect(h.llmCalls[0]!.tools).toEqual(expect.arrayContaining(['fleex_ticket_todo_list', 'fleex_ticket_todo_done', 'fleex_ticket_todo_add']));
  });

  it('an empty todo is still announced (the assistant may start one), without inventing items', async () => {
    const h = harness([{ text: 'ok' }], { todoAgentAccess: true, extraCliTools: todoTools, todos: [] });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(userPrompt(h)).toContain('## Todo list\n(vide)');
    expect(userPrompt(h)).not.toContain('- [ ]');
  });

  for (const todoAgentAccess of [false, undefined]) {
    it(`with todoAgentAccess ${todoAgentAccess === false ? 'off' : 'unset (off by default)'}: no todo section, no steering rules, no fleex_ticket_todo_* tool — even with items on the ticket`, async () => {
      const h = harness([{ tools: [{ name: 'fleex_ticket_todo_done', input: { ticket: '1', ref: '2' } }] }, { text: 'ok' }],
        { todoAgentAccess, extraCliTools: todoTools, todos });
      await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
      expect(userPrompt(h)).not.toMatch(/todo/i);
      expect(h.llmCalls[0]!.system).not.toContain('## La todo du ticket');
      expect(h.llmCalls[0]!.system).not.toContain('fleex_ticket_todo');
      expect(h.llmCalls[0]!.tools.filter((t) => t.startsWith('fleex_ticket_todo'))).toEqual([]);
      // The other CLI tools stay, and are counted without the todo ones.
      expect(h.llmCalls[0]!.tools).toContain('fleex_ticket_show');
      expect(h.llmCalls[0]!.system).toContain('1 outils `fleex_*`');
      // A todo tool the model calls anyway (from memory) does not reach the CLI.
      expect(h.cliCalls).toEqual([]);
      expect(resultBlocks(h, 1)[0]!.is_error).toBe(true);
    });
  }
});

describe('RunAssistantTurnUseCase — @type:slug in a message to the assistant is an order to delegate', () => {
  const catalyst = () => persona('catalyst');
  const review = { id: 'w-review', slug: 'review', name: 'Review', description: 'Code review then QA.', enabled: true };
  const lint = { id: 's-lint', commandName: 'lint', name: 'lint', displayName: 'Lint', markdownContent: 'Lint.', enabled: true };
  const delegateTo = (name: string, turn = 'go', targetType = 'agent') => ({ name: 'delegate', input: { targetType, name, brief: `brief ${name}`, turn } });
  /** The human sends `body` to the assistant: the comment, and the trigger the route builds from it. */
  const says = async (h: ReturnType<typeof harness>, id: string, body: string) => {
    await pause();
    await h.comments.save(TicketCommentEntity.create({ id, ticketId: 't1', authorType: 'user', authorName: 'Olivier', body }));
    await pause();
    return { kind: 'user_message' as const, commentId: id, requestedTargets: extractRequestedTargets(body) };
  };
  const userPrompt = (h: ReturnType<typeof harness>) => h.llmCalls[0]!.messages[0]!.content as string;
  /** The reminders the server sent during the turn (plain user messages after the first). */
  const reminders = (h: ReturnType<typeof harness>) => h.llmCalls.at(-1)!.messages.slice(1)
    .filter((m) => m.role === 'user' && typeof m.content === 'string').map((m) => m.content as string);
  const threadTurns = (h: ReturnType<typeof harness>, name: string) => {
    const t = [...h.threads.saved.values()].find((x) => x.personaName === name);
    return t ? h.comments.saved.filter((c) => c.threadId === t.id).map((c) => c.body) : [];
  };
  const mainStream = (h: ReturnType<typeof harness>) => h.comments.saved.filter((c) => c.threadId === null && c.authorType === 'assistant').map((c) => c.body);

  // Acceptance criterion: « @agent:catalyst spécifie X » opens a catalyst thread whose first turn contains the original sentence.
  it('the first turn of the thread contains the human sentence as is, even when the model rewrote it', async () => {
    const h = harness([{ tools: [delegateTo('catalyst', 'Objectif : rédiger la spec de X.')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:catalyst spécifie X') });
    const [turn] = threadTurns(h, 'catalyst');
    expect(turn).toBe(`@agent:catalyst Objectif : rédiger la spec de X.\n\n---\n${ORIGINAL_MESSAGE_HEADER}\n\n@agent:catalyst spécifie X`);
    expect(h.mentions.saved.map((m) => m.targetAgent)).toEqual(['catalyst']);
    expect(userPrompt(h)).toContain('- @agent:catalyst — valide · aucun thread ouvert');
    expect(reminders(h)).toEqual([]);
  });

  it('attachments travel with it: the file link of the message reaches the target unchanged', async () => {
    const file = '![capture](/api/files/11111111-2222-4333-8444-555555555555)';
    const h = harness([{ tools: [delegateTo('catalyst', 'Regarde la capture.')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', `@agent:catalyst que vois-tu ?\n\n${file}`) });
    expect(threadTurns(h, 'catalyst')[0]).toContain(`@agent:catalyst que vois-tu ?\n\n${file}`);
  });

  it('a turn that already quotes the message in full is sent untouched (nothing is added twice)', async () => {
    const h = harness([{ tools: [delegateTo('catalyst', 'Contexte : ticket e2e.\n« @agent:catalyst   spécifie X »\nDéfinition de fini : un livrable spec.')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:catalyst spécifie X') });
    expect(threadTurns(h, 'catalyst')[0]).not.toContain(ORIGINAL_MESSAGE_HEADER);
  });

  it('a target the human did not mention gets the turn the model wrote, nothing more', async () => {
    const h = harness([{ tools: [delegateTo('catalyst'), delegateTo('builder', 'construis')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:catalyst spécifie X') });
    expect(threadTurns(h, 'builder')).toEqual(['@agent:builder construis']);
  });

  // Acceptance criterion: two mentions in one message ⇒ two threads opened in the same turn.
  it('two mentions open two threads in the same turn; each turn launches its own target only, though both quote the whole message', async () => {
    const h = harness([{ tools: [delegateTo('catalyst'), delegateTo('builder')] }, { text: '' }], { extraPersonas: [catalyst()] });
    const body = '@agent:catalyst spécifie X et @agent:builder prépare le terrain';
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', body) });
    expect([...h.threads.saved.values()].map((t) => [t.personaName, t.status]).sort()).toEqual([['builder', 'running'], ['catalyst', 'running']]);
    expect(threadTurns(h, 'catalyst')[0]).toContain(body);
    expect(threadTurns(h, 'builder')[0]).toContain(body);
    // One mention per thread: the tag of the other target, quoted in the turn, launched nothing.
    expect(h.mentions.saved.map((m) => m.targetAgent).sort()).toEqual(['builder', 'catalyst']);
    expect(h.llmCalls).toHaveLength(2);
    expect(reminders(h)).toEqual([]);
  });

  // Acceptance criterion: the model ignores the mention on the first pass ⇒ the reminder round fires.
  it('the model ignores the mention: the server sends ONE reminder round, and the delegation happens there', async () => {
    const h = harness([{ text: 'Je regarde.' }, { tools: [delegateTo('catalyst', 'spec')] }, { text: '' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:catalyst spécifie X') });
    expect(reminders(h)).toHaveLength(1);
    expect(reminders(h)[0]).toMatch(/^Rappel du serveur : tu n'as pas traité @agent:catalyst\./);
    expect(reminders(h)[0]).toContain('délègue');
    expect(reminders(h)[0]).toContain('explique pourquoi');
    expect(threadTurns(h, 'catalyst')[0]).toContain('@agent:catalyst spécifie X');
    expect(h.llmCalls).toHaveLength(3);
  });

  it('it still does not delegate: its explanation is posted as is, nothing is launched by force, and it is not reminded twice', async () => {
    const h = harness([{ text: 'Builder corrige les e2e.' }, { text: "Je n'ai pas lancé @agent:builder : tu demandais seulement ce qu'il fait." }, { text: 'jamais lu' }]);
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', 'que fait @agent:builder ?') });
    expect(h.llmCalls).toHaveLength(2);
    expect(mainStream(h)).toEqual(["Builder corrige les e2e.\n\nJe n'ai pas lancé @agent:builder : tu demandais seulement ce qu'il fait."]);
    // The tag in the explanation is text: no thread, and no direct mention either.
    expect(h.threads.saved.size).toBe(0);
    expect(h.mentions.saved).toEqual([]);
  });

  it('only the targets left out are named in the reminder', async () => {
    const h = harness([{ tools: [delegateTo('catalyst')] }, { text: 'Catalyst est lancé.' }, { text: 'Builder attendra.' }], { extraPersonas: [catalyst()] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:catalyst spécifie puis @agent:builder construis') });
    expect(reminders(h)).toHaveLength(1);
    expect(reminders(h)[0]).toContain('@agent:builder');
    expect(reminders(h)[0]).not.toContain('@agent:catalyst');
  });

  it('a message with no mention, and a wake-up, are never reminded', async () => {
    const h = harness([{ text: 'ok' }, { text: 'ok' }]);
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', 'où en est-on ?') });
    expect(h.llmCalls).toHaveLength(1);
    await h.uc.execute({ ticketId: 't1', trigger: wake('nope') });
    expect(h.llmCalls).toHaveLength(2);
  });

  // The rule: a target is handled once the model made a thread action for it,
  // whatever the server answered. A refusal it read and explained is not ignored.
  it('a launch the server refused (one writer at a time) is not a mention ignored: no reminder, and the model is told to sequence', async () => {
    const h = harness([{ tools: [delegateTo('builder'), delegateTo('catalyst')] }, { text: 'Builder est lancé ; Catalyst partira à son retour.' }, { text: 'jamais lu' }], { extraPersonas: [catalyst()] });
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:builder construis et @agent:catalyst documente') });
    expect([...h.threads.saved.values()].map((t) => t.personaName)).toEqual(['builder']);
    expect(String(resultBlocks(h, 1)[1]!.content)).toMatch(/^Refusé.*un seul thread à la fois peut écrire/);
    expect(reminders(h)).toEqual([]);
    expect(h.llmCalls).toHaveLength(2);
    expect(h.llmCalls[0]!.system).toMatch(/Le serveur refuse un lancement.*les cibles passent l'une après l'autre/);
    expect(mainStream(h)).toEqual(['Builder est lancé ; Catalyst partira à son retour.']);
  });

  it('the reminder fits in the round budget: with no round left, the server says itself what was not delegated', async () => {
    const show = { name: 'fleex_ticket_show', input: { id: '1' } };
    const rounds: Round[] = [...Array.from({ length: ASSISTANT_MAX_ROUNDS - 1 }, () => ({ tools: [show] })), { text: 'Voilà.' }, { text: 'jamais lu' }];
    const h = harness(rounds);
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:builder corrige') });
    expect(h.llmCalls).toHaveLength(ASSISTANT_MAX_ROUNDS);
    expect(reminders(h)).toEqual([]);
    expect(mainStream(h)[0]).toMatch(/^Voilà\.\n\nJe n'ai pas délégué à @agent:builder pendant ce tour\./);
    expect(h.mentions.saved).toEqual([]);
  });

  it('an unknown or disabled slug opens no thread: the turn is told it is invalid, with what exists, and is not reminded about it', async () => {
    const off = { ...lint, id: 's-off', commandName: 'old', enabled: false };
    const h = harness([{ text: 'Je ne connais pas ces cibles. Skills : lint.' }, { text: 'jamais lu' }], { skills: [lint, off] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:ghost et @skill:old, au travail') });
    const prompt = userPrompt(h);
    expect(prompt).toMatch(/- @agent:ghost — INVALIDE : n'ouvre aucun thread.*Personas disponibles : nas, builder/);
    expect(prompt).toMatch(/- @skill:old — INVALIDE.*Skills disponibles : lint/);
    expect(h.llmCalls).toHaveLength(1);
    expect(h.threads.saved.size).toBe(0);
    expect(h.mentions.saved).toEqual([]);
  });

  it('an open thread with the target is continued, not doubled; a running one is announced as such', async () => {
    const h = harness([{ tools: [delegateTo('builder')] }, { text: '' }, { tools: [delegateTo('builder', 'la suite')] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const before = h.llmCalls.length;
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:builder ajoute les tests') });
    expect(h.llmCalls[before]!.messages[0]!.content).toContain(`- @agent:builder — valide · thread déjà ouvert ${thread.id} (running) : continue-le`);
    expect(h.llmCalls[before]!.messages[0]!.content).toContain('interrupt: true');
    expect(h.threads.saved.size).toBe(1);
    // Lot 1's rule: still on its previous turn, and no interrupt asked — nothing is sent, the model is told to wait.
    expect(toolResults(h).at(-1)).toContain('travaille encore sur le tour précédent');
    expect(reminders(h)).toEqual([]);
  });

  describe('a workflow mentioned while a run is active', () => {
    const active = () => ({ workflows: [review], runs: [run('r0', 'manual', 'needs_review')] });

    // Acceptance criterion: no second run, and a message that explains it.
    it('the model tries anyway: refused, no thread, no mention — and its explanation is posted', async () => {
      const h = harness([{ tools: [delegateTo('review', 'go', 'workflow')] }, { text: 'Un run de review attend déjà ta validation : je n’en lance pas un second.' }], active());
      await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@workflow:review relance') });
      expect(userPrompt(h)).toMatch(/- @workflow:review — valide, mais un workflow tourne déjà sur ce ticket \(run r0, needs_review\).*Ne lance rien/);
      expect(h.threads.saved.size).toBe(0);
      expect(h.mentions.saved).toEqual([]);
      expect(toolResults(h)[0]).toContain('Un workflow tourne déjà sur ce ticket (run r0');
      expect(mainStream(h)).toEqual(['Un run de review attend déjà ta validation : je n’en lance pas un second.']);
    });

    it('the model says nothing: the server posts the explanation itself, and sends no reminder (nothing could be launched)', async () => {
      const h = harness([{ text: '' }, { text: 'jamais lu' }], active());
      await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@workflow:review relance') });
      expect(h.llmCalls).toHaveLength(1);
      expect(mainStream(h)).toEqual(["Je n'ai pas lancé @workflow:review : un workflow tourne déjà sur ce ticket (run r0, needs_review) : un seul run actif par ticket, pas de second run."]);
      expect(h.threads.saved.size).toBe(0);
      expect(h.mentions.saved).toEqual([]);
    });

    it('with no active run the same mention is an ordinary order: ignored, it is reminded', async () => {
      const h = harness([{ text: 'hmm' }, { tools: [delegateTo('review', 'go', 'workflow')] }, { text: '' }], { workflows: [review] });
      await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@workflow:review lance') });
      expect(reminders(h)).toHaveLength(1);
      expect(h.mentions.saved.map((m) => m.targetType)).toEqual(['workflow']);
    });
  });

  // Acceptance criterion: a target under userHold is accepted, since the message comes from the human.
  it('a mention of a target the human had stopped is accepted: the hold is lifted and the thread relaunched', async () => {
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }, { tools: [delegateTo('builder', 'reprends')] }, { text: '' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const thread = [...h.threads.saved.values()][0]!;
    const m = h.mentions.saved[0]!; m.acknowledge(); await h.mentions.save(m);
    h.executeAgent.running[m.id] = ['exec-1'];
    await h.stopRun.stopThread(thread, { by: 'user', reason: 'stop' });
    expect(thread.userHoldAt).toBeInstanceOf(Date);

    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', '@agent:builder reprends où tu en étais') });
    expect(toolResults(h).at(-1)).not.toMatch(/^Refusé/);
    expect(thread.userHoldAt).toBeNull();
    expect(thread.status).toBe('running');
    expect(h.mentions.saved).toHaveLength(2);
    expect(threadTurns(h, 'builder').at(-1)).toContain('@agent:builder reprends où tu en étais');
  });

  it('what the assistant says in the main stream never launches a target, whatever tags it names', async () => {
    const h = harness([{ text: 'Cibles : @agent:builder, @skill:lint, @workflow:review.' }], { skills: [lint], workflows: [review] });
    await h.uc.execute({ ticketId: 't1', trigger: await says(h, 'c1', 'qui peut m’aider ?') });
    expect(mainStream(h)).toEqual(['Cibles : @agent:builder, @skill:lint, @workflow:review.']);
    expect(h.mentions.saved).toEqual([]);
  });
});

describe('RunAssistantTurnUseCase — mandate and escalation (lot 6)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 3));
  const catalyst = () => persona('catalyst');
  const sentinel = () => persona('sentinel');
  const team = { extraPersonas: [catalyst(), sentinel()] };
  const delegateTo = (name: string, turn = 'go') => ({ name: 'delegate', input: { targetType: 'agent', name, brief: `brief ${name}`, turn } });
  const MANDATE = '## Objectif\nExport CSV.\n\n## Critères d\'acceptation\n- le fichier se télécharge\n\n## Plan\n1. spec 2. build 3. revue\n\n## Ce que je décide seul\nLe nommage.\n\n## Ce que je te remonte\nLe merge.';
  const propose = (markdown = MANDATE, title = 'Mandat : export CSV') => ({ name: 'propose_mandate', input: { title, markdown } });
  const says = async (h: ReturnType<typeof harness>, id: string, body: string) => {
    await tick();
    await h.comments.save(TicketCommentEntity.create({ id, ticketId: 't1', authorType: 'user', authorName: 'Olivier', body }));
    await tick();
    return user(id);
  };
  /** One assistant turn with its own script; returns the tool results the model read, in order. */
  const turn = async (h: ReturnType<typeof harness>, trigger: Parameters<typeof h.uc.execute>[0]['trigger'], rounds: Round[]) => {
    let n = 0;
    const first = h.llmCalls.length;
    h.setLlm(async (p, onText) => {
      h.llmCalls.push({ model: p.model, thinking: p.thinking, system: p.system, tools: [], messages: p.messages });
      const r = rounds[n++] ?? {};
      if (r.text) onText(r.text);
      const content: Anthropic.ContentBlock[] = [...(r.text ? [textBlock(r.text)] : []), ...(r.tools ?? []).map((t, i) => toolUse(t.name, t.input, `m-${first}-${n}-${i}`))];
      return { content, stopReason: r.tools?.length ? 'tool_use' : 'end_turn' };
    });
    await h.uc.execute({ ticketId: 't1', trigger });
    return {
      results: resultBlocks(h, h.llmCalls.length - 1).map((r) => String(r.content)),
      prompt: h.llmCalls[first]!.messages[0]!.content as string,
    };
  };
  const mandateOf = (h: ReturnType<typeof harness>) => h.deliverables.saved[0]!;
  const main = (h: ReturnType<typeof harness>) => h.comments.saved.filter((c) => c.threadId === null && c.authorType === 'assistant');
  const byTarget = (h: ReturnType<typeof harness>, name: string) => [...h.threads.saved.values()].find((t) => t.personaName === name);
  /** A harness whose ticket is in edit mode (a persona then writes) with a mandate proposed and waiting. */
  const withDraft = async () => {
    const h = harness([], team);
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    await turn(h, await says(h, 'c1', 'Fais l’export CSV'), [{ text: 'Voici le mandat.', tools: [propose()] }, {}]);
    return h;
  };

  it('propose_mandate writes a draft `plan` deliverable under the assistant’s name and asks ONE question, Go / Ajuster, on the last comment of the turn', async () => {
    const h = await withDraft();
    expect(h.deliverables.saved).toHaveLength(1);
    expect(mandateOf(h)).toMatchObject({ type: 'plan', status: 'draft', agentName: 'Nas', title: 'Mandat : export CSV', version: 1, content: MANDATE, ticketId: 't1' });
    expect(h.emitted).toContain('deliverable.created');
    const posted = main(h);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.questions).toEqual([{ prompt: 'Mandat « Mandat : export CSV » : je lance ?', options: ['Go', 'Ajuster'] }]);
    expect(posted[0]!.body).toBe('Voici le mandat.\n\nMandat « Mandat : export CSV » : je lance ?\n- Go\n- Ajuster');
  });

  it('the mandate question stands alone: ask_user in the same turn is refused, and questions asked before it are withdrawn', async () => {
    const h = harness([], team);
    const { results } = await turn(h, await says(h, 'c1', 'Fais l’export CSV'), [
      { tools: [{ name: 'ask_user', input: { questions: [{ text: 'CSV ou XLSX ?', options: ['CSV', 'XLSX'] }] } }] },
      { tools: [propose()] },
      { tools: [{ name: 'ask_user', input: { questions: [{ text: 'Autre ?', options: ['Oui', 'Non'] }] } }] },
      {},
    ]);
    expect(results[1]).toContain('`ask_user` de ce tour sont retirées');
    expect(results[2]).toMatch(/^Refusé/);
    expect(main(h).at(-1)!.questions).toEqual([{ prompt: 'Mandat « Mandat : export CSV » : je lance ?', options: ['Go', 'Ajuster'] }]);
    // No text from the model: the server says what the question is about.
    expect(main(h).at(-1)!.body).toContain('Le mandat est prêt : « Mandat : export CSV » (livrable plan, brouillon v1).');
  });

  // Acceptance criterion, server part: once a mandate is proposed, a `plan` deliverable exists and no writing launch precedes the human's Go.
  it('while the mandate is a draft, a launch that writes is refused — in the proposing turn, on a wake-up, and on a human message that is not a Go', async () => {
    const h = harness([], team);
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    const same = await turn(h, await says(h, 'c1', 'Fais l’export CSV'), [{ tools: [propose()] }, { tools: [delegateTo('builder')] }, {}]);
    expect(same.results[1]).toMatch(/^Refusé, rien n'a été lancé : le mandat « Mandat : export CSV » est en brouillon/);
    const woken = await turn(h, { kind: 'ticket_created' }, [{ tools: [delegateTo('builder')] }, {}]);
    expect(woken.results[0]).toMatch(/^Refusé/);
    const other = await turn(h, await says(h, 'c2', 'et pense aux accents'), [{ tools: [delegateTo('builder')] }, {}]);
    expect(other.results[0]).toMatch(/^Refusé/);
    expect(h.threads.saved.size).toBe(0);
    expect(h.mentions.saved).toEqual([]);
    expect(mandateOf(h).status).toBe('draft');
  });

  it('the guard covers skills and continue_thread too, and leaves framing possible: a persona that only reads is launched', async () => {
    const lint = { id: 's1', commandName: 'lint', name: 'lint', displayName: 'Lint', markdownContent: 'Lint.', enabled: true };
    const h = harness([], { ...team, skills: [lint] });
    // Ticket in plan mode: the spec persona reads, it does not write.
    await turn(h, await says(h, 'c0', 'Cadre l’export'), [{ tools: [delegateTo('catalyst', 'Spécifie')] }, {}]);
    await turn(h, await says(h, 'c1', 'ok'), [{ tools: [propose()] }, {}]);
    const spec = byTarget(h, 'catalyst')!;
    const m = h.mentions.saved[0]!; m.acknowledge(); m.resolve(); await h.mentions.save(m);
    spec.markIdle(); await h.threads.save(spec);
    const framing = await turn(h, wake(spec.id), [{ tools: [{ name: 'continue_thread', input: { threadId: spec.id, turn: 'précise le format' } }] }, {}]);
    expect(framing.results[0]).not.toMatch(/^Refusé/);
    const skill = await turn(h, wake(spec.id), [{ tools: [{ name: 'delegate', input: { targetType: 'skill', name: 'lint', brief: 'lint', turn: 'x' } }] }, {}]);
    expect(skill.results[0]).toMatch(/^Refusé, rien n'a été lancé : le mandat/);
    // The same thread becomes a writer once the ticket is in edit mode: continuing it is refused as well.
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    const m2 = h.mentions.saved.at(-1)!; m2.acknowledge(); m2.resolve(); await h.mentions.save(m2);
    spec.markIdle(); await h.threads.save(spec);
    const cont = await turn(h, wake(spec.id), [{ tools: [{ name: 'continue_thread', input: { threadId: spec.id, turn: 'écris' } }] }, {}]);
    expect(cont.results[0]).toMatch(/^Refusé, rien n'a été lancé : le mandat/);
  });

  it('the « Go » button makes the mandate final in the server, before the model runs — the launch of that very turn is accepted', async () => {
    const h = await withDraft();
    const go = await turn(h, await says(h, 'c2', 'Go'), [{ tools: [delegateTo('builder')] }, {}]);
    expect(mandateOf(h).status).toBe('final');
    expect(h.deliverables.saved).toHaveLength(1);
    expect(go.prompt).toContain("VALIDÉ À L'INSTANT");
    expect(go.results[0]).not.toMatch(/^Refusé/);
    expect(byTarget(h, 'builder')!.status).toBe('running');
    expect(h.emitted).toContain('deliverable.updated');
  });

  it('a wake-up can never validate a mandate: confirm_mandate is refused outside a human message later than the draft', async () => {
    const h = harness([], team);
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    // In the turn that proposes it: the human message is older than the mandate.
    const same = await turn(h, await says(h, 'c1', 'Fais l’export CSV'), [{ tools: [propose()] }, { tools: [{ name: 'confirm_mandate', input: {} }] }, {}]);
    expect(same.results[1]).toMatch(/^Refusé, le mandat reste en brouillon/);
    for (const trigger of [{ kind: 'ticket_created' as const }, wake('nope'), { kind: 'relaunch_request' as const, threadId: 'nope' }]) {
      const r = await turn(h, trigger, [{ tools: [{ name: 'confirm_mandate', input: {} }] }, { tools: [delegateTo('builder')] }, {}]);
      expect(r.results[0]).toMatch(/^Refusé, le mandat reste en brouillon/);
      expect(r.results[1]).toMatch(/^Refusé/);
    }
    expect(mandateOf(h).status).toBe('draft');
    expect(h.threads.saved.size).toBe(0);
  });

  it('a Go in the human’s own words: the model confirms, the server accepts because the message is later than the draft', async () => {
    const h = await withDraft();
    const r = await turn(h, await says(h, 'c2', 'ok pour moi, vas-y'), [{ tools: [{ name: 'confirm_mandate', input: {} }] }, { tools: [delegateTo('builder')] }, {}]);
    expect(r.prompt).toContain('BROUILLON, en attente du « Go »');
    expect(r.results[0]).toContain('validé (final)');
    expect(r.results[1]).not.toMatch(/^Refusé/);
    expect(mandateOf(h).status).toBe('final');
  });

  it('the assistant cannot validate or rewrite its mandate through the CLI', async () => {
    const updateTool: CliTool = {
      name: 'fleex_ticket_deliverable_update', commandPath: ['ticket', 'deliverable', 'update'], description: 'Update', mutating: true,
      workspaceAware: true, jsonAware: true, inputSchema: { type: 'object', properties: {}, required: ['ticketId', 'deliverableId'] },
      arguments: [{ key: 'ticketId', required: true, variadic: false }, { key: 'deliverableId', required: true, variadic: false }],
      options: [{ key: 'status', flag: '--status', takesValue: true, description: '' }],
    };
    const h = harness([], { ...team, extraCliTools: [updateTool] });
    await turn(h, await says(h, 'c1', 'Fais l’export CSV'), [{ tools: [propose()] }, {}]);
    const id = mandateOf(h).id;
    const r = await turn(h, wake('nope'), [
      { tools: [{ name: 'fleex_ticket_deliverable_update', input: { ticketId: '1', deliverableId: id, status: 'final' } }] },
      { tools: [{ name: 'fleex_ticket_deliverable_update', input: { ticketId: '1', deliverableId: 'another', status: 'final' } }] },
      {},
    ]);
    expect(r.results[0]).toMatch(/^Refusé, rien n'a été modifié : ce livrable est le mandat/);
    // Any other deliverable still goes to the CLI.
    expect(h.cliCalls).toEqual([['ticket', 'deliverable', 'update', '1', 'another', '--status', 'final', '--workspace', 'qa', '--json']]);
  });

  it('« Ajuster »: the draft stays a draft and is revised in place — same deliverable, new version, question asked again', async () => {
    const h = await withDraft();
    const id = mandateOf(h).id;
    const asked = await turn(h, await says(h, 'c2', 'Ajuster'), [{ text: 'Que veux-tu changer ?' }]);
    expect(asked.prompt).toContain('BROUILLON, en attente du « Go »');
    expect(mandateOf(h).status).toBe('draft');
    await turn(h, await says(h, 'c3', 'ajoute l’export XLSX'), [{ tools: [propose(`${MANDATE}\n- XLSX aussi`)] }, {}]);
    expect(h.deliverables.saved).toHaveLength(1);
    expect(mandateOf(h)).toMatchObject({ id, status: 'draft', version: 2 });
    expect(mandateOf(h).content).toContain('XLSX aussi');
    expect(main(h).at(-1)!.questions![0]!.options).toEqual(['Go', 'Ajuster']);
    // The Go given to v1 does not carry over: the revised draft needs its own.
    const stale = await turn(h, wake('nope'), [{ tools: [delegateTo('builder')] }, {}]);
    expect(stale.results[0]).toMatch(/^Refusé/);
  });

  it('revising a validated mandate puts it back in draft, keeps the decisions noted, and holds the launches again', async () => {
    const h = await withDraft();
    await turn(h, await says(h, 'c2', 'Go'), [{ tools: [{ name: 'note_decision', input: { decision: 'Séparateur « ; »', reason: 'Excel FR' } }] }, {}]);
    await turn(h, await says(h, 'c3', 'finalement ajoute le XLSX'), [{ tools: [propose('## Objectif\nCSV et XLSX.')] }, { tools: [delegateTo('builder')] }, {}]);
    expect(mandateOf(h).status).toBe('draft');
    expect(mandateOf(h).content).toMatch(/^## Objectif\nCSV et XLSX\.\n\n## Décisions prises\n- .* — Séparateur « ; » — Raison : Excel FR\n$/);
    expect(h.threads.saved.size).toBe(0);
  });

  it('note_decision appends to « Décisions prises » of the validated mandate, and the next turn reads it back in its prompt', async () => {
    const h = await withDraft();
    const draft = await turn(h, wake('nope'), [{ tools: [{ name: 'note_decision', input: { decision: 'x', reason: 'y' } }] }, {}]);
    expect(draft.results[0]).toContain('encore en brouillon');
    await turn(h, await says(h, 'c2', 'Go'), [
      { tools: [{ name: 'note_decision', input: { decision: 'Séparateur « ; »', reason: 'Excel FR' } }] },
      { tools: [{ name: 'note_decision', input: { decision: 'Pas de BOM', reason: 'inutile en UTF-8' } }] },
      {},
    ]);
    const content = mandateOf(h).content;
    expect(content.startsWith(MANDATE)).toBe(true);
    expect(content).toMatch(/## Décisions prises\n- \d{4}-\d\d-\d\d \d\d:\d\d UTC — Séparateur « ; » — Raison : Excel FR\n- [^\n]* — Pas de BOM — Raison : inutile en UTF-8\n$/);
    expect(mandateOf(h).status).toBe('final');
    const next = await turn(h, wake('nope'), [{}]);
    expect(next.prompt).toContain('## Mandat\n« Mandat : export CSV » · v3 · validé (final)');
    expect(next.prompt).toContain('Pas de BOM — Raison : inutile en UTF-8');
  });

  it('with no mandate (short task) nothing changes: launches go, note_decision and confirm_mandate say there is none', async () => {
    const h = harness([], team);
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    const r = await turn(h, await says(h, 'c1', 'corrige la typo'), [
      { tools: [{ name: 'note_decision', input: { decision: 'x', reason: 'y' } }, { name: 'confirm_mandate', input: {} }, delegateTo('builder')] }, {},
    ]);
    expect(r.results[0]).toContain('Aucun mandat');
    expect(r.results[1]).toContain('Aucun mandat');
    expect(r.results[2]).not.toMatch(/^Refusé/);
    expect(r.prompt).toContain('## Mandat\n(aucun');
    expect(h.deliverables.saved).toEqual([]);
  });

  it('a `plan` deliverable written by someone else is not the mandate: it holds nothing', async () => {
    const h = harness([], team);
    h.ticket.updateExecutionConfig({ conversationMode: 'edit' });
    await new SubmitDeliverableUseCase(h.deliverables as never, { saveActivity: async () => {} } as never, { get: () => ({}) } as never, logger as never)
      .execute({ ticketId: 't1', agentName: 'catalyst', type: 'plan', title: 'Plan de Catalyst', content: 'x', status: 'draft' });
    const r = await turn(h, await says(h, 'c1', 'construis'), [{ tools: [delegateTo('builder')] }, {}]);
    expect(r.results[0]).not.toMatch(/^Refusé/);
    expect(r.prompt).toContain('## Mandat\n(aucun');
  });

  // Acceptance criterion: after « Go », spec → build → review runs with no human message and no question.
  it('after Go, spec → build → review: each wake-up leads to the next launch in ONE turn, the mandate stays final, nothing is asked', async () => {
    const h = await withDraft();
    const settle = async (name: string) => {
      const t = byTarget(h, name)!;
      const m = (await h.mentions.getById(t.currentMentionId!))!; m.acknowledge(); m.resolve(); await h.mentions.save(m);
      t.markIdle(); await h.threads.save(t);
      return t;
    };
    await turn(h, await says(h, 'c2', 'Go'), [{ tools: [delegateTo('catalyst', 'Spécifie')] }, {}]);
    const humanMessages = h.comments.saved.filter((c) => c.authorType === 'user').length;
    const questionsBefore = main(h).filter((c) => c.questions?.length).length;
    const turnsBefore = h.agentEvents.executions.length;

    const spec = await settle('catalyst');
    const afterSpec = await turn(h, wake(spec.id), [
      { tools: [{ name: 'conclude_thread', input: { threadId: spec.id, summary: 'Spec livrée.' } }, { name: 'note_decision', input: { decision: 'Colonnes dans l’ordre de l’écran', reason: 'la spec ne le fixe pas' } }, delegateTo('builder', 'Construis')] }, {},
    ]);
    const build = await settle('builder');
    const afterBuild = await turn(h, wake(build.id), [
      { tools: [{ name: 'conclude_thread', input: { threadId: build.id, summary: 'Build fait, tests verts.' } }, delegateTo('sentinel', 'Relis')] }, {},
    ]);
    const review = await settle('sentinel');
    await turn(h, wake(review.id), [
      { tools: [{ name: 'conclude_thread', input: { threadId: review.id, summary: 'Revue OK.' } }] },
      { text: '**Résultat** fait.\n**Décisions prises** : colonnes dans l’ordre de l’écran.' },
    ]);

    for (const r of [...afterSpec.results, ...afterBuild.results]) expect(r).not.toMatch(/^Refusé/);
    expect([spec, build, review].map((t) => t.status)).toEqual(['concluded', 'concluded', 'concluded']);
    // Three wake-ups, three assistant turns: none needed a second pass or a human.
    expect(h.agentEvents.executions.length - turnsBefore).toBe(3);
    expect(h.comments.saved.filter((c) => c.authorType === 'user')).toHaveLength(humanMessages);
    expect(main(h).filter((c) => c.questions?.length)).toHaveLength(questionsBefore);
    expect(mandateOf(h).status).toBe('final');
    // The decision taken alone at the first wake-up is in the prompt of the last turn, where the final report is written.
    expect(h.llmCalls.at(-1)!.messages[0]!.content as string).toContain('Colonnes dans l’ordre de l’écran — Raison : la spec ne le fixe pas');
  });

  describe('grouped questions (ask_user)', () => {
    const q = (text: string, options = ['Oui', 'Non']) => ({ text, options });
    it('up to 4 questions go out in ONE message, declared, after the model’s text — and a launch in the same turn still goes', async () => {
      const h = harness([], team);
      const r = await turn(h, await says(h, 'c1', 'avance'), [
        { text: 'Deux points à trancher.', tools: [{ name: 'ask_user', input: { questions: [q('Format ?', ['CSV', 'XLSX']), q('Avec en-têtes ?')] } }, delegateTo('catalyst')] },
        { tools: [{ name: 'ask_user', input: { questions: [q('Séparateur ?', [',', ';']), q('BOM ?')] } }] },
        {},
      ]);
      expect(r.results[1]).not.toMatch(/^Refusé/);
      expect(byTarget(h, 'catalyst')!.status).toBe('running');
      const posted = main(h);
      expect(posted).toHaveLength(1);
      expect(posted[0]!.questions).toEqual([
        { prompt: 'Format ?', options: ['CSV', 'XLSX'] }, { prompt: 'Avec en-têtes ?', options: ['Oui', 'Non'] },
        { prompt: 'Séparateur ?', options: [',', ';'] }, { prompt: 'BOM ?', options: ['Oui', 'Non'] },
      ]);
      expect(posted[0]!.body).toBe('Deux points à trancher.\n\nFormat ?\n- CSV\n- XLSX\n\nAvec en-têtes ?\n- Oui\n- Non\n\nSéparateur ?\n- ,\n- ;\n\nBOM ?\n- Oui\n- Non');
      // The question is the last word of the main stream: that is where Tasks, Focus and mobile look for it.
      expect(h.comments.saved.filter((c) => c.threadId === null).at(-1)!.id).toBe(posted[0]!.id);
    });

    it('a fifth question is refused, none is dropped in silence; a question the UI could not render is refused too', async () => {
      const h = harness([], team);
      const r = await turn(h, await says(h, 'c1', 'avance'), [
        { tools: [{ name: 'ask_user', input: { questions: [q('1 ?'), q('2 ?'), q('3 ?'), q('4 ?'), q('5 ?')] } }] },
        { tools: [{ name: 'ask_user', input: { questions: [q('Long ?', ['a'.repeat(81), 'b'])] } }] },
        { tools: [{ name: 'ask_user', input: { questions: [q('Une seule option ?', ['a'])] } }] },
        { text: 'Rien à demander finalement.' },
      ]);
      expect(r.results[0]).toMatch(/^Refusé, rien n'a été posé : 4 questions au plus par message, tu en déclares 5/);
      expect(r.results[1]).toMatch(/^Refusé, rien n'a été posé : chaque question a 2 à 5 options/);
      expect(r.results[2]).toContain('Arguments invalides');
      expect(main(h).map((c) => [c.body, c.questions])).toEqual([['Rien à demander finalement.', null]]);
    });
  });

  describe('the cost of the ticket, for the final report', () => {
    it('is the sum of the finished executions, assistant turns included, this turn excluded', async () => {
      const h = harness([], team);
      h.agentEvents.costs = [{ status: 'completed', costUsd: 1.5 }, { status: 'failed', costUsd: 0.25 }, { status: 'interrupted', costUsd: 0.1 }];
      const r = await turn(h, user('c0'), [{ text: 'ok' }]);
      expect(r.prompt).toContain("## Coût du ticket\n1,85 $ sur 3 exécution(s) terminée(s), agents et tours d'assistant compris, hors tour en cours.");
    });

    it('an unknown cost is said unknown, never counted as 0; a run in flight is not counted yet', async () => {
      const h = harness([], team);
      h.agentEvents.costs = [{ status: 'completed', costUsd: 2 }, { status: 'completed', costUsd: null }, { status: 'running', costUsd: null }];
      const r = await turn(h, user('c0'), [{ text: 'ok' }]);
      expect(r.prompt).toContain('## Coût du ticket\nau moins 2,00 $ sur 1 exécution(s) terminée(s)');
      expect(r.prompt).toContain('1 exécution(s) au coût inconnu, non comptée(s) ; 1 en cours, pas encore comptée(s).');
      h.agentEvents.costs = [{ status: 'completed', costUsd: null }];
      const none = await turn(h, user('c0'), [{ text: 'ok' }]);
      expect(none.prompt).toContain('## Coût du ticket\ninconnu (');
      expect(none.prompt).not.toContain('0,00 $');
    });
  });

  it('with the switch off nothing runs: no mandate is read, written or validated', async () => {
    const h = harness([{ tools: [propose()] }, {}], { workThreadsEnabled: false });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.llmCalls).toEqual([]);
    expect(h.deliverables.saved).toEqual([]);
    expect(h.comments.saved).toEqual([]);
  });
});

describe('RunAssistantTurnUseCase — its own hands and eyes', () => {
  const IMG = '11111111-2222-3333-4444-555555555555';
  const OLD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const png = (label: string) => ({ name: `${label}.png`, mimeType: 'image/png', buffer: Buffer.from(`PNG-${label}`) });
  /** A workspace on fakes: files in a map, shell calls recorded. */
  function fakeWorkspace() {
    const files = new Map<string, string>([['/ws/t1/README.md', 'bonjour']]);
    const shells: Array<{ command: string; cwd: string }> = [];
    let resolved = 0;
    const port: AssistantWorkspacePort = {
      resolve: async () => { resolved += 1; return '/ws/t1'; },
      readFile: async (path) => { if (!files.has(path)) throw new Error(`ENOENT: ${path}`); return Buffer.from(files.get(path)!); },
      writeFile: async (path, content) => { files.set(path, content); },
      shell: async (command, o) => { shells.push({ command, cwd: o.cwd }); return { stdout: 'On branch main', stderr: '', exitCode: 0 }; },
    };
    return { port, files, shells, resolved: () => resolved };
  }
  const firstMessage = (h: ReturnType<typeof harness>) => h.llmCalls[0]!.messages[0]!.content;

  it('sees the image the user uploads in their message: it reaches the model as an image, not as a dead link', async () => {
    const h = harness([{ text: 'Je vois le bouton rouge.' }], { attachments: { [IMG]: png('capture') } });
    await h.comments.save(TicketCommentEntity.create({ id: 'c0', ticketId: 't1', authorType: 'user', authorName: 'Olivier', body: `regarde ![capture.png](/api/files/${IMG})` }));
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const content = firstMessage(h) as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png('capture').buffer.toString('base64') } });
    // The prompt stays the last block: that is where the cache breakpoint goes.
    expect(content.at(-1)).toMatchObject({ type: 'text' });
    // The execution log names the image; it never stores the bytes.
    expect(JSON.stringify(h.agentEvents.events)).not.toContain(png('capture').buffer.toString('base64'));
    expect(JSON.stringify(h.agentEvents.events)).toContain('capture.png');
  });

  it('a message without an image keeps a plain text prompt', async () => {
    const h = harness([{ text: 'ok' }], { attachments: {} });
    await h.comments.save(TicketCommentEntity.create({ id: 'c0', ticketId: 't1', authorType: 'user', authorName: 'Olivier', body: 'salut' }));
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(typeof firstMessage(h)).toBe('string');
  });

  it('reads an older attachment of the discussion on demand, without preparing a workspace for it', async () => {
    const ws = fakeWorkspace();
    const h = harness([{ tools: [{ name: 'Read', input: { path: `/api/files/${OLD}` } }] }, { text: 'Vu.' }], { workspace: ws.port, attachments: { [OLD]: png('ancienne') } });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    const result = resultBlocks(h, 1)[0]!;
    expect(result.is_error).toBe(false);
    expect((result.content as Anthropic.ImageBlockParam[]).some((b) => b.type === 'image')).toBe(true);
    expect(ws.resolved()).toBe(0);
  });

  it('has an agent\'s edit-mode hands — Read, Write, Edit, Bash in the ticket workspace — whatever the ticket mode', async () => {
    const ws = fakeWorkspace();
    const h = harness([
      { tools: [{ name: 'Read', input: { path: 'README.md' } }] },
      { tools: [{ name: 'Edit', input: { path: 'README.md', old_string: 'bonjour', new_string: 'salut' } }, { name: 'Write', input: { path: 'notes/a.txt', content: 'x' } }] },
      { tools: [{ name: 'Bash', input: { command: 'git status' } }] },
      { text: 'Fait.' },
    ], { workspace: ws.port });
    expect(h.ticket.conversationMode).not.toBe('edit');
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.llmCalls[0]!.tools).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']));
    const results = resultBlocks(h, 3);
    expect(results.map((r) => r.is_error)).toEqual([false, false, false, false]);
    expect(results[0]!.content).toBe('bonjour');
    expect(ws.files.get('/ws/t1/README.md')).toBe('salut');
    expect(ws.files.get('/ws/t1/notes/a.txt')).toBe('x');
    expect(ws.shells).toEqual([{ command: 'git status', cwd: '/ws/t1' }]);
    expect(results[3]!.content).toContain('On branch main');
    // One workspace for the whole turn.
    expect(ws.resolved()).toBe(1);
    // The prompt tells it what these hands are for: it still delegates the bulk.
    expect(h.llmCalls[0]!.system).toContain('Tu délègues toujours le gros du travail');
  });

  it('a turn that only talks or delegates prepares no workspace', async () => {
    const ws = fakeWorkspace();
    const h = harness([{ tools: [delegateBuilder] }, { text: '' }], { workspace: ws.port });
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(ws.resolved()).toBe(0);
  });

  it('without the workspace port the hands are neither offered nor described', async () => {
    const h = harness([{ text: 'ok' }]);
    await h.uc.execute({ ticketId: 't1', trigger: user('c0') });
    expect(h.llmCalls[0]!.tools).not.toContain('Bash');
    expect(h.llmCalls[0]!.system).not.toContain('`Bash`');
  });
});
