import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEventType, AgentQuestion, AgentThreadTargetType } from '@fleex/shared';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { ThreadStorePort } from '../ports/thread-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { knownFileIds, repairFileReferences } from '../utils/repair-file-references.js';
import type { EventBus } from '../event-bus.js';
import type { AnyDomainEvent } from '../../domain/events.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { GetTicketContextUseCase } from './get-ticket-context.js';
import type { ExecuteAgentUseCase } from './execute-agent.js';
import type { StopRunUseCase } from './stop-run.js';
import { buildExecutionStartData } from '../utils/build-execution-start-data.js';
import { priceFor } from '../utils/cli-session-ingest.js';
import type { AssistantEnvironmentPort } from '../assistant/assistant-environment.js';
import type { AssistantLlm } from '../assistant/assistant-llm.js';
import { cliToolArgv, cliToolsToAnthropic, type CliTool } from '../assistant/fleex-cli-tools.js';
import {
  ACTION_TOOLS,
  buildAssistantSystemPrompt,
  buildAssistantUserPrompt,
  parseActionToolInput,
  renderQuestion,
  assistantQuestions,
  skillSummary,
  type AssistantCapabilities,
  type AssistantAction,
  type AssistantTrigger,
} from '../assistant/assistant-protocol.js';

/** A tag that would create a mention if posted in a comment. */
const MENTION_TAG = /@(agent|skill|panel|workflow):\S/;

export const MAX_ASSISTANT_TURNS_PER_THREAD = 8;

/** How a tool result names what was launched. */
const TARGET_LABEL: Record<AgentThreadTargetType, string> = {
  agent: "l'agent", skill: 'le skill', panel: 'le panel', workflow: 'le workflow',
};
/** How the thread records a stop by the assistant: « Run arrêté par <assistant> : <reason> ». */
export const STOP_LINE_PREFIX = 'Run arrêté par ';

/** « 3 min 05 s » since an ISO instant, for the tool result of a stop. */
function elapsed(sinceIso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(sinceIso)) / 1000));
  if (!Number.isFinite(s)) return 'une durée inconnue';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
/** « à 14:02 », server time: how a refusal dates the human action it defers to. */
function stopClock(at: Date): string {
  return `à ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}
/** Consecutive agent failures after which the assistant stops relaunching and reports back. */
export const MAX_THREAD_FAILURES = 3;
/** Tool rounds one assistant turn may take before it must answer. */
export const ASSISTANT_MAX_ROUNDS = 8;
/** Streamed text is coalesced into agent_events of about this size, or after this delay. */
export const ASSISTANT_DELTA_CHUNK_CHARS = 60;
export const ASSISTANT_DELTA_FLUSH_MS = 150;
/** Between the text of two model rounds (around a tool call), in the stream and in the posted comment alike. */
export const ROUND_SEPARATOR = '\n\n';

/**
 * What one assistant turn cost, from the tokens its completions billed (same
 * price list as manual CLI sessions; cache writes at the 5-minute rate, the
 * only TTL the assistant would use). Undefined for an unpriced model: an
 * unknown cost, not a free one.
 */
export function assistantTurnCostUsd(
  model: string,
  u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number },
): number | undefined {
  const p = priceFor(model);
  if (!p) return undefined;
  return u.inputTokens * p.inp + u.outputTokens * p.out + u.cacheReadTokens * p.read + u.cacheCreationTokens * p.w5;
}

/** Machine-readable tail of a mode-request comment; the web renders it as a CTA. Invisible in markdown. */
export function modeRequestMarker(mode: string, threadId: string): string {
  return `<!-- fleex:mode-request ${JSON.stringify({ mode, threadId })} -->`;
}

export interface RunAssistantTurnDeps {
  threadStore: ThreadStorePort;
  commentStore: CommentStorePort;
  mentionStore: MentionStorePort;
  ticketStore: TicketStorePort;
  personaStore: PersonaStorePort;
  /** Delegation targets besides personas. Null stores (unsupported adapter) offer none of that kind. */
  skillStore?: SkillStorePort | null;
  panelStore?: PanelStorePort | null;
  workflowTemplateStore?: WorkflowTemplateStorePort | null;
  workflowRunStore?: WorkflowRunStorePort | null;
  postComment: PostCommentUseCase;
  getTicketContext: GetTicketContextUseCase;
  agentEventStore: AgentEventStorePort;
  executeAgent: Pick<ExecuteAgentUseCase, 'wakeUp'>;
  /** The single stop path: every run the assistant stops goes through it, with its author. */
  stopRun: Pick<StopRunUseCase, 'stopThread'>;
  config: ConfigPort;
  eventBus: EventBus;
  logger: LoggerPort;
  /** Workspace, `fleex_*` tools and their executor — the assistant's hand on Fleex. */
  environment: AssistantEnvironmentPort;
}

/**
 * One assistant turn: a streamed Messages-API conversation (like the companion),
 * where the model talks to the user in text and acts through tools — the four
 * thread actions plus the `fleex_*` CLI. Turns on the same ticket are serialised;
 * nothing here loops on its own — the next turn only comes from a new event.
 */
export class RunAssistantTurnUseCase {
  /** Set by the WS plugin to stream agent events live (same as ExecuteAgent). */
  public onEvent: ((event: AgentEventEntity) => void) | null = null;
  private lanes = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: RunAssistantTurnDeps,
    private readonly llm: AssistantLlm,
  ) {}

  /** The `workThreadsEnabled` switch (opt-in: absent = off), read on every call so it applies without a restart. */
  get enabled(): boolean {
    return this.deps.config.get().workThreadsEnabled === true;
  }

  /** Null when the assistant is switched off: callers then behave as if none were configured. */
  async resolveAssistantPersona(ticket: TicketEntity): Promise<AgentPersonaEntity | null> {
    if (!this.enabled) return null;
    const id = ticket.assistantPersonaId ?? this.deps.config.get().defaultAssistantPersonaId ?? null;
    return id ? this.deps.personaStore.getById(id) : null;
  }

  execute(params: { ticketId: string; trigger: AssistantTrigger }): Promise<void> {
    if (!this.enabled) {
      this.deps.logger.info('Assistant switched off (workThreadsEnabled is not true); turn skipped', { ticketId: params.ticketId, trigger: params.trigger.kind });
      return Promise.resolve();
    }
    const prev = this.lanes.get(params.ticketId) ?? Promise.resolve();
    const run = prev
      .then(() => this.runTurn(params))
      .catch((err) => {
        this.deps.logger.error('Assistant turn failed', {
          ticketId: params.ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    this.lanes.set(params.ticketId, run);
    return run;
  }

  private async runTurn({ ticketId, trigger }: { ticketId: string; trigger: AssistantTrigger }): Promise<void> {
    const ticket = await this.deps.ticketStore.getTicketById(ticketId);
    if (!ticket) return;
    const assistant = await this.resolveAssistantPersona(ticket);
    if (!assistant) {
      this.deps.logger.info('No assistant persona configured; skipping turn', { ticketId });
      return;
    }
    if (!this.deps.environment.hasApiKey) {
      await this.postAssistant(ticket, assistant, null,
        "Je ne peux pas répondre : aucune clé Anthropic n'est configurée pour l'assistant (ANTHROPIC_API_KEY dans ~/.fleex/config ou l'environnement du serveur).");
      return;
    }

    const [context, allThreads, personas, cliTools, capabilities] = await Promise.all([
      this.deps.getTicketContext.execute({ ticketId, agentName: assistant.name }),
      this.deps.threadStore.getByTicket(ticketId),
      this.deps.personaStore.getAll(),
      this.deps.environment.cliTools(),
      this.loadCapabilities(),
    ]);
    const threadId = trigger.kind === 'user_message' || trigger.kind === 'ticket_created' ? null : trigger.threadId;
    const turns = threadId ? context.comments.filter((c) => c.threadId === threadId) : [];
    let threadDeliverables: typeof context.deliverables = [];
    const thread = threadId ? allThreads.find((t) => t.id === threadId) : undefined;
    if (thread?.targetType === 'workflow') {
      // A workflow's output is its run's deliverables; its steps do not post into the thread.
      const run = await this.workflowRunOf(thread);
      threadDeliverables = run ? context.deliverables.filter((d) => d.workflowRunId === run.id) : [];
    } else if (threadId && turns.length > 0) {
      const turnIds = new Set(turns.map((c) => c.id));
      const mentionIds = new Set(context.mentions.all.filter((m) => turnIds.has(m.commentId)).map((m) => m.id));
      threadDeliverables = context.deliverables.filter((d) => d.mentionId && mentionIds.has(d.mentionId));
    }

    const system = buildAssistantSystemPrompt({
      env: { ticketId: ticket.id, displayId: ticket.displayId, workspace: this.deps.environment.workspace, cliToolCount: cliTools.length },
      persona: assistant,
      assistantName: assistant.displayName || assistant.name,
      personas: personas
        .filter((p) => p.id !== assistant.id)
        .map((p) => ({ name: p.name, displayName: p.displayName, identityMd: p.identityMd })),
      capabilities,
    });
    const userPrompt = buildAssistantUserPrompt({ context, threads: allThreads.map((t) => t.toDTO()), trigger, turns, threadDeliverables });
    const model = ticket.modelOverride ?? assistant.model;
    const tools = [...ACTION_TOOLS, ...cliToolsToAnthropic(cliTools)] as Anthropic.Tool[];
    const cliByName = new Map(cliTools.map((t) => [t.name, t]));

    // ── Execution log (run card + view log), same plumbing as agent runs ──
    const executionId = randomUUID();
    const mentionKey = `assistant:${randomUUID()}`;
    await this.deps.agentEventStore.startExecution({ executionId, personaId: assistant.id, ticketId, mentionId: mentionKey, model });
    // Events are appended AND broadcast strictly in order: a delta must never
    // overtake the previous one on the wire, whatever the store's latency.
    let sequence = 0;
    let chain: Promise<void> = Promise.resolve();
    const emitEvent = (eventType: AgentEventType, data: unknown): Promise<void> => {
      const event = AgentEventEntity.create({ executionId, eventType, data, sequence: sequence++ });
      chain = chain.then(async () => {
        await this.deps.agentEventStore.appendEvent(event);
        this.onEvent?.(event);
      });
      return chain;
    };
    // Text is streamed token by token; one agent_event per token would flood the
    // store and the socket. Deltas are coalesced into small chunks.
    let textBuffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushText = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!textBuffer) return;
      const text = textBuffer;
      textBuffer = '';
      void emitEvent('content_block_delta', { type: 'assistant', message: { content: [{ type: 'text', text }] } });
    };
    const onTextDelta = (delta: string) => {
      textBuffer += delta;
      if (textBuffer.length >= ASSISTANT_DELTA_CHUNK_CHARS) flushText();
      else if (!flushTimer) flushTimer = setTimeout(flushText, ASSISTANT_DELTA_FLUSH_MS);
    };
    await emitEvent('execution_start', buildExecutionStartData({
      executionId, personaId: assistant.id, personaName: assistant.name, ticketId, mentionId: mentionKey, model,
      effectiveMode: 'talk', worktreePath: null, resumeSessionId: null, kind: 'assistant', maxTurns: ASSISTANT_MAX_ROUNDS,
      systemPromptSections: ['Fleex environment', 'Persona', 'Assistant protocol'], systemPromptLength: system.length,
      userPromptLength: userPrompt.length, ticketTitle: context.ticket.title, ticketStatus: context.ticket.status,
      commentsCount: context.comments.length, deliverablesCount: context.deliverables.length,
    }));
    await emitEvent('execution_context', { executionId, systemPrompt: system, promptBlocks: [{ type: 'text', text: userPrompt }], model, effectiveMode: 'talk', maxTurns: ASSISTANT_MAX_ROUNDS });

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    // Billed even when the turn fails afterwards: the failure path records it too.
    const metrics = () => ({ model, effectiveMode: 'talk', ...usage, costUsd: assistantTurnCostUsd(model, usage) });
    // Everything the model says to the user this turn, one entry per round that
    // spoke. The posted comment is exactly what was streamed: all rounds, joined
    // by a blank line — the same separator the live deltas carry.
    const said: string[] = [];
    let finalText = '';
    let concluded = false;
    let threadActionTaken = false;
    let threads = allThreads;

    try {
      for (let round = 0; round < ASSISTANT_MAX_ROUNDS; round++) {
        let roundText = '';
        let separator = said.length > 0 ? ROUND_SEPARATOR : '';
        const res = await this.llm({ model, system, messages, tools }, (delta) => {
          roundText += delta;
          if (separator && delta.trim()) {
            onTextDelta(separator);
            separator = '';
          }
          onTextDelta(delta);
        });
        flushText();
        await chain;
        usage.inputTokens += res.usage?.inputTokens ?? 0;
        usage.outputTokens += res.usage?.outputTokens ?? 0;
        usage.cacheReadTokens += res.usage?.cacheReadTokens ?? 0;
        usage.cacheCreationTokens += res.usage?.cacheCreationTokens ?? 0;
        messages.push({ role: 'assistant', content: res.content });

        const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        const spoken = roundText.trim() || (toolUses.length === 0
          ? res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim()
          : '');
        if (spoken) said.push(spoken);
        finalText = said.join(ROUND_SEPARATOR);
        if (toolUses.length === 0) break;

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const call of toolUses) {
          const input = (call.input ?? {}) as Record<string, unknown>;
          await emitEvent('content_block_delta', { type: 'assistant', message: { content: [{ type: 'tool_use', id: call.id, name: call.name, input }] } });
          let text: string;
          let isError = false;
          const action = parseActionToolInput(call.name, input);
          const cli = cliByName.get(call.name);
          if (action) {
            if (threadActionTaken && action.action !== 'request_mode') {
              text = 'Refusé : une seule action de thread par tour. Termine ton message.';
              isError = true;
            } else {
              threads = await this.deps.threadStore.getByTicket(ticketId);
              text = await this.apply(ticket, assistant, action, threads, trigger);
              threadActionTaken = true;
              if (action.action === 'conclude_thread') concluded = true;
            }
          } else if (cli && cli.name === 'fleex_ticket_comment' && MENTION_TAG.test(String(input.body ?? ''))) {
            // A comment through the CLI is posted as the user: its tags would launch
            // targets outside any thread, with no author and no wake-up.
            text = "Refusé, rien n'a été posté : ce commentaire contient une mention (@agent:, @skill:, @panel: ou @workflow:). Pour lancer une cible, utilise `delegate` ou `continue_thread` ; sinon retire le tag.";
            isError = true;
          } else if (cli) {
            try {
              const argv = cliToolArgv(cli, input, this.deps.environment.workspace);
              const r = await this.deps.environment.runCli(argv);
              text = r.text;
              isError = !r.ok;
            } catch (err) {
              text = `Arguments invalides : ${err instanceof Error ? err.message : String(err)}`;
              isError = true;
            }
          } else if (call.name in { delegate: 1, continue_thread: 1, stop_thread: 1, conclude_thread: 1, request_mode: 1 }) {
            text = 'Arguments invalides pour cette action (champs requis manquants).';
            isError = true;
          } else {
            text = `Outil inconnu : ${call.name}`;
            isError = true;
          }
          await emitEvent('content_block_delta', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: call.id, content: text, is_error: isError }] } });
          results.push({ type: 'tool_result', tool_use_id: call.id, content: text, is_error: isError });
        }
        messages.push({ role: 'user', content: results });
      }

      // A conclude request is not negotiable: if the model did not conclude, do it with its words.
      if (trigger.kind === 'conclude_request' && !concluded) {
        threads = await this.deps.threadStore.getByTicket(ticketId);
        await this.apply(ticket, assistant, {
          action: 'conclude_thread', threadId: trigger.threadId, question: null, message: null,
          summary: finalText || "Thread conclu à la demande de l'utilisateur.",
        }, threads, trigger);
        finalText = '';
      }

      if (finalText) {
        await this.postAssistant(ticket, assistant, null, finalText);
      } else if (!threadActionTaken) {
        this.deps.logger.warn('Assistant produced neither text nor action', { ticketId, executionId });
        await this.postAssistant(ticket, assistant, null, "Je n'ai pas pu traiter ce message. Reformule, ou réessaie.");
      }

      await this.deps.agentEventStore.completeExecution(executionId, 'completed', metrics());
      await emitEvent('execution_end', { status: 'completed', ticketId, ...metrics() });
    } catch (err) {
      flushText();
      await this.deps.agentEventStore.completeExecution(executionId, 'failed', metrics());
      await emitEvent('execution_end', { status: 'failed', ticketId, ...metrics(), error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Applies one thread action and returns the tool result the model reads back. */
  private async apply(
    ticket: TicketEntity,
    assistant: AgentPersonaEntity,
    action: AssistantAction,
    threads: AgentThreadEntity[],
    trigger: AssistantTrigger,
  ): Promise<string> {
    if (action.action === 'delegate' || action.action === 'continue_thread') {
      // The human closed the ticket. A wake-up (agent answer, workflow end,
      // repair) is not them asking for more work: the assistant may only conclude.
      if (trigger.kind === 'thread_reply' && (ticket.status === 'done' || ticket.status === 'cancelled')) {
        return `Refusé, rien n'a été lancé : le ticket est en statut « ${ticket.status} ». Sur un réveil, tu peux seulement conclure les threads ouverts ("conclude_thread") ; ne relance rien tant que l'utilisateur ne le demande pas.`;
      }
      const relayed = await this.relayAttachments(ticket, action.turn);
      if ('error' in relayed) return relayed.error;
      if (relayed.text !== action.turn) action = { ...action, turn: relayed.text };
    }
    switch (action.action) {
      case 'reply':
        await this.postAssistant(ticket, assistant, null, action.message + renderQuestion(action.question), { questions: assistantQuestions(action.question) });
        return 'Message posté.';

      case 'delegate': {
        const open = threads.find((t) => t.targetType === action.targetType && t.personaName === action.name && !t.isTerminal);
        if (open) return this.continueThread(ticket, assistant, open, action.turn, trigger);
        const target = await this.resolveTarget(action.targetType, action.name);
        if ('error' in target) return target.error;
        // The human concluded the last thread with this target: reopening one is
        // theirs to ask, not something a wake-up decides.
        const last = threads
          .filter((t) => t.targetType === action.targetType && t.personaName === action.name && t.isTerminal && t.concludedAt)
          .sort((a, b) => b.concludedAt!.getTime() - a.concludedAt!.getTime())[0];
        if (last?.concludedBy === 'user' && !(await this.humanAskedSince(trigger, last.concludedAt!, last.id))) {
          return `Refusé, rien n'a été lancé : l'utilisateur a conclu lui-même le thread avec ${target.displayName} (${stopClock(last.concludedAt!)}). Tu ne rouvres pas un thread avec cette cible sans un nouveau message de sa part, et tu ne confies pas ce travail à une autre cible.`;
        }
        if (action.targetType === 'workflow') {
          const busy = await this.activeWorkflowRun(ticket.id);
          if (busy) return `Un workflow tourne déjà sur ce ticket (run ${busy.id}, ${busy.status}) : un seul run actif par ticket. Rien n'a été lancé.`;
        }
        if (action.message) await this.postAssistant(ticket, assistant, null, action.message);
        const thread = AgentThreadEntity.create({
          id: randomUUID(), ticketId: ticket.id, personaId: target.id, personaName: target.name,
          assistantPersonaId: assistant.id, brief: action.brief, forwardedContext: action.forward,
          targetType: action.targetType,
        });
        await this.deps.threadStore.save(thread);
        this.emit({ type: 'thread.created', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        await this.openTurn(ticket, assistant, thread, action.turn);
        return `Thread ${thread.id} ouvert avec ${target.displayName} ; ${TARGET_LABEL[action.targetType]} a été lancé. Tu seras rappelé quand il aura fini.`;
      }

      case 'continue_thread': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread) return `Thread inconnu : ${action.threadId}.`;
        if (thread.isTerminal) return 'Ce thread est déjà clos.';
        if (!action.interrupt) return this.continueThread(ticket, assistant, thread, action.turn, trigger);
        // Stop, THEN the new turn — in that order, in this single call: the
        // one-thread-action-per-turn guard would refuse a separate `stop_thread`.
        const stop = await this.stopThreadRun(ticket, assistant, thread, 'remplacé par une nouvelle consigne');
        if (stop.blocked) return stop.text; // could not be stopped: sending a turn would queue behind the live run
        const sent = await this.continueThread(ticket, assistant, thread, action.turn, trigger);
        return stop.stopped ? `${stop.text}\n${sent}` : sent;
      }

      case 'stop_thread': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread) return `Thread inconnu : ${action.threadId}.`;
        if (thread.isTerminal) return 'Ce thread est déjà clos.';
        return (await this.stopThreadRun(ticket, assistant, thread, action.reason)).text;
      }

      case 'request_mode': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (thread && !thread.isTerminal) {
          thread.markWaiting();
          await this.deps.threadStore.save(thread);
          this.emit({ type: 'thread.updated', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        }
        await this.postAssistant(ticket, assistant, null, `${action.message}\n\n${modeRequestMarker(action.mode, action.threadId)}`);
        return `Demande de passage en mode ${action.mode} posée à l'utilisateur. Le mode reste « ${ticket.conversationMode} » tant qu'il n'a pas cliqué.`;
      }

      case 'conclude_thread': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread) return `Thread inconnu : ${action.threadId}.`;
        if (thread.isTerminal) return 'Ce thread est déjà clos.';
        const target = await this.resolveTarget(thread.targetType, thread.personaName);
        const mentionId = thread.currentMentionId;
        // A conclusion the human asked for (the Conclude button) is theirs.
        const by = trigger.kind === 'conclude_request' ? 'user' as const : 'assistant' as const;
        // Whatever still runs in the thread is stopped through the single stop
        // path, with its author. A workflow run is left alone, as before: it may
        // be parked on a decision that belongs to the human.
        if (thread.targetType !== 'workflow') await this.deps.stopRun.stopThread(thread, { by, reason: 'thread conclu' });
        thread.conclude(action.summary, by);
        await this.deps.threadStore.save(thread);
        if (mentionId) {
          const mention = await this.deps.mentionStore.getById(mentionId);
          if (mention && mention.status !== 'resolved') {
            mention.resolve();
            await this.deps.mentionStore.save(mention);
            this.emit({ type: 'mention.resolved', mentionId, ticketId: ticket.id, targetAgent: mention.targetAgent, resolvedBy: assistant.name, occurredAt: new Date() });
          }
        }
        const who = 'error' in target ? thread.personaName : target.displayName;
        const lead = action.message ? `${action.message}\n\n` : '';
        await this.postAssistant(ticket, assistant, null, `${lead}Retour de ${who} : ${action.summary}${renderQuestion(action.question)}`, { questions: assistantQuestions(action.question) });
        this.emit({ type: 'thread.concluded', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        return `Thread conclu ; le résumé a été posté dans le fil.`;
      }
    }
  }

  /**
   * A turn that relays a screenshot carries a `/api/files/<uuid>` the model retyped by
   * hand. Fix a slightly wrong id to the attachment it meant; refuse (before anything
   * is sent) an id that matches nothing on the ticket, telling the model the valid ones.
   */
  private async relayAttachments(ticket: TicketEntity, turn: string): Promise<{ text: string } | { error: string }> {
    if (!turn.includes('/api/files/')) return { text: turn };
    const known = knownFileIds((await this.deps.commentStore.getByTicket(ticket.id)).map((c) => c.body));
    const { text, repaired, unresolved } = repairFileReferences(turn, known);
    for (const r of repaired) this.deps.logger.warn('Assistant retyped an attachment id wrongly; corrected', { ticketId: ticket.id, ...r });
    if (unresolved.length > 0) {
      return {
        error: `Rien n'a été envoyé : la pièce jointe ${unresolved.join(', ')} n'existe pas sur ce ticket (identifiant mal recopié). `
          + `Recopie l'identifiant EXACTEMENT depuis le message de l'utilisateur. Pièces jointes connues : ${[...known].join(', ') || 'aucune'}.`,
      };
    }
    return { text };
  }

  /**
   * The assistant stops the run of a thread and leaves the thread open: the
   * single stop path with author `assistant`, a line in the thread saying so,
   * and a tool result that tells the model what was running and for how long.
   * `blocked`: the target could not be stopped — said explicitly, never a silent no-op.
   */
  private async stopThreadRun(
    ticket: TicketEntity, assistant: AgentPersonaEntity, thread: AgentThreadEntity, reason: string,
  ): Promise<{ stopped: boolean; blocked: boolean; text: string }> {
    const target = await this.resolveTarget(thread.targetType, thread.personaName);
    const who = 'error' in target ? thread.personaName : target.displayName;
    const what = `${TARGET_LABEL[thread.targetType]} ${who}`;
    const out = await this.deps.stopRun.stopThread(thread, { by: 'assistant', reason });
    if (out.unsupported) {
      return { stopped: false, blocked: true, text: `Impossible d'arrêter ${what} : ${out.unsupported}. Rien n'a été arrêté ni envoyé ; dis-le à l'utilisateur.` };
    }
    if (!out.stopped) {
      return { stopped: false, blocked: false, text: `Rien ne tournait dans ce thread (statut ${thread.status}) : rien n'a été arrêté.` };
    }
    const assistantName = assistant.displayName || assistant.name;
    // No mention may come out of this line, whatever the reason quotes.
    await this.postAssistant(ticket, assistant, thread.id, `${STOP_LINE_PREFIX}${assistantName} : ${reason}`, { suppressAgentMentions: true });
    const since = out.startedAt ? ` depuis ${elapsed(out.startedAt)}` : '';
    const was = out.what === 'workflow_run'
      ? `le run ${out.workflowRunId} tournait${since} ; il est annulé (cancelled)`
      : out.what === 'queued'
        ? "son tour était en file d'attente et n'avait pas démarré ; il est annulé"
        : `une exécution tournait${since} ; elle est interrompue`;
    return {
      stopped: true, blocked: false,
      text: `Arrêté — ${what} : ${was}. Le thread reste ouvert (idle), aucun échec n'est compté, et tu ne seras pas rappelé pour cet arrêt.`,
    };
  }

  /** Assistant turn inside a thread: wake a waiting mention, or open a new one. */
  private async continueThread(ticket: TicketEntity, assistant: AgentPersonaEntity, thread: AgentThreadEntity, turn: string, trigger: AssistantTrigger): Promise<string> {
    // The human stopped this target. Only they lift the hold: a message of
    // theirs later than the stop makes this turn free to relaunch; a wake-up
    // never does, whatever the model decided.
    if (thread.userHoldAt) {
      if (!(await this.humanAskedSince(trigger, thread.userHoldAt, thread.id))) {
        return `Refusé, rien n'a été envoyé : l'utilisateur a arrêté ${thread.personaName} (${stopClock(thread.userHoldAt)}). Tu ne peux pas relancer cette cible tant qu'il ne l'a pas demandé — un message de sa part après l'arrêt, ou le bouton « Relancer ». Ne confie pas ce travail à une autre cible ; dis-lui simplement où en est le thread s'il te le demande.`;
      }
      thread.liftUserHold();
    }
    if (thread.status === 'failed' && thread.failures >= MAX_THREAD_FAILURES) {
      return this.apply(ticket, assistant, {
        action: 'conclude_thread', threadId: thread.id, question: null,
        message: `Je n'arrive pas à faire aboutir ${thread.personaName} sur ce point après ${thread.failures} tentatives.`,
        summary: `Abandon après ${thread.failures} échecs consécutifs de l'agent. À reprendre autrement.`,
      }, [thread], trigger);
    }
    const assistantTurns = (await this.deps.commentStore.getByTicket(ticket.id))
      // The line that records a stop is not a turn sent to the agent.
      .filter((c) => c.threadId === thread.id && c.authorType === 'assistant' && !c.body.startsWith(STOP_LINE_PREFIX)).length;
    if (assistantTurns >= MAX_ASSISTANT_TURNS_PER_THREAD) {
      return this.apply(ticket, assistant, {
        action: 'conclude_thread', threadId: thread.id, message: null, question: null,
        summary: `Thread interrompu après ${assistantTurns} échanges sans conclusion.`,
      }, [thread], trigger);
    }
    if (thread.targetType === 'workflow') {
      const run = await this.workflowRunOf(thread);
      if (run?.isActive()) {
        return `Le workflow ${thread.personaName} est encore en cours (run ${run.id}, ${run.status}) : rien n'a été relancé. Tu seras rappelé quand il s'arrêtera.`;
      }
      const busy = await this.activeWorkflowRun(ticket.id);
      if (busy) return `Un autre workflow tourne sur ce ticket (run ${busy.id}) : un seul run actif par ticket. Rien n'a été relancé.`;
    }
    const current = thread.currentMentionId ? await this.deps.mentionStore.getById(thread.currentMentionId) : null;

    // Rows from before the author of a stop was recorded only carry the two
    // booleans of migration 048, and no hold on the thread: same rule, read from
    // the execution — left alone unless the human asked since.
    if (thread.currentMentionId) {
      const execution = await this.deps.agentEventStore.getExecutionByMentionId(thread.currentMentionId);
      if (execution && (execution.manuallyTerminatedByUser || execution.autoTerminatedAtConclusion)
        && !(await this.humanAskedSince(trigger, new Date(execution.completedAt ?? execution.startedAt), thread.id))) {
        return `${thread.personaName} a été arrêté manuellement ou lors de la conclusion du thread : rien n'a été relancé. Tu ne le relances que si l'utilisateur le demande.`;
      }
    }

    // The agent is still on its previous turn (queued or running): a new mention
    // would queue behind it on the same lane and go stale. The assistant is called
    // back when the turn settles, with the whole conversation in context.
    if (current && (current.status === 'pending' || current.status === 'acknowledged')) {
      return `${thread.personaName} travaille encore sur le tour précédent : rien n'a été envoyé. Tu seras rappelé quand il aura répondu ; transmets alors ce qui est nouveau. Dis simplement à l'utilisateur que tu transmettras à la fin du tour.`;
    }
    if (current && current.status === 'waiting_for_info') {
      await this.postAssistant(ticket, assistant, thread.id, `${thread.mentionTag} ${turn}`, { suppressMentionForAgents: [thread.personaName] });
      thread.recordTurn();
      thread.markRunning();
      await this.deps.threadStore.save(thread);
      if (ticket.blocked) {
        ticket.update({ blocked: false });
        await this.deps.ticketStore.saveTicket(ticket);
        this.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: { blocked: { from: true, to: false } }, occurredAt: new Date() });
      }
      await this.deps.executeAgent.wakeUp(current);
      this.emit({ type: 'thread.updated', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
      return `Réponse transmise à ${thread.personaName}, qui reprend. Tu seras rappelé quand il aura répondu.`;
    }
    await this.openTurn(ticket, assistant, thread, turn);
    return `Nouveau tour envoyé à ${thread.personaName}, relancé. Tu seras rappelé quand il aura répondu.`;
  }

  /**
   * True when the current turn carries a human request later than `since`: a
   * message the human sent the assistant after that instant, or their click on
   * « Relancer » for this very thread. A wake-up, and a conclude request, never do.
   */
  private async humanAskedSince(trigger: AssistantTrigger, since: Date, threadId: string): Promise<boolean> {
    if (trigger.kind === 'relaunch_request') return trigger.threadId === threadId;
    if (trigger.kind === 'ticket_created') return true;
    if (trigger.kind !== 'user_message') return false;
    const comment = await this.deps.commentStore.getById(trigger.commentId);
    return !!comment && comment.authorType === 'user' && comment.createdAt.getTime() > since.getTime();
  }

  private async openTurn(ticket: TicketEntity, assistant: AgentPersonaEntity, thread: AgentThreadEntity, turn: string): Promise<void> {
    const { createdMentions } = await this.postAssistant(ticket, assistant, thread.id, `${thread.mentionTag} ${turn}`);
    const mention = createdMentions.find((m) => m.targetAgent === thread.personaName && m.targetType === thread.targetType);
    if (mention) thread.openTurn(mention.id);
    else thread.recordTurn();
    await this.deps.threadStore.save(thread);
    this.emit({ type: 'thread.updated', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
  }

  /** Enabled skills, panels and workflows, as the system prompt lists them. */
  private async loadCapabilities(): Promise<AssistantCapabilities> {
    const [skills, panels, workflows, personas] = await Promise.all([
      this.deps.skillStore?.getEnabled() ?? [],
      this.deps.panelStore?.getEnabled() ?? [],
      this.deps.workflowTemplateStore?.getEnabled() ?? [],
      this.deps.personaStore.getAll(),
    ]);
    const personaName = new Map(personas.map((p) => [p.id, p.displayName || p.name]));
    return {
      skills: skills.map((s) => ({ name: s.commandName, displayName: s.displayName || s.name, description: skillSummary(s.markdownContent) })),
      panels: panels.map((p) => ({
        name: p.name, displayName: p.displayName, description: p.description,
        members: p.members.map((m) => personaName.get(m.personaId) ?? m.personaId),
      })),
      workflows: workflows.map((w) => ({ slug: w.slug, name: w.name, description: w.description })),
    };
  }

  /** The delegation target named by the assistant, or the tool error it reads back. */
  private async resolveTarget(type: AgentThreadTargetType, name: string): Promise<{ id: string; name: string; displayName: string } | { error: string }> {
    switch (type) {
      case 'agent': {
        const p = await this.deps.personaStore.getByName(name);
        if (p) return { id: p.id, name: p.name, displayName: p.displayName || p.name };
        return { error: `Persona inconnue : « ${name} ». Personas disponibles : ${(await this.deps.personaStore.getAll()).map((x) => x.name).join(', ')}.` };
      }
      case 'skill': {
        const s = await this.deps.skillStore?.getByCommandName(name);
        if (s?.enabled) return { id: s.id, name: s.commandName, displayName: s.displayName || s.name };
        return { error: `Skill inconnu ou désactivé : « ${name} ». Skills disponibles : ${((await this.deps.skillStore?.getEnabled()) ?? []).map((x) => x.commandName).join(', ') || 'aucun'}.` };
      }
      case 'panel': {
        const p = await this.deps.panelStore?.getByName(name);
        if (p?.enabled) return { id: p.id, name: p.name, displayName: p.displayName || p.name };
        return { error: `Panel inconnu ou désactivé : « ${name} ». Panels disponibles : ${((await this.deps.panelStore?.getEnabled()) ?? []).map((x) => x.name).join(', ') || 'aucun'}.` };
      }
      case 'workflow': {
        const w = await this.deps.workflowTemplateStore?.getBySlug(name);
        if (w?.enabled) return { id: w.id, name: w.slug, displayName: w.name };
        return { error: `Workflow inconnu ou désactivé : « ${name} ». Workflows disponibles : ${((await this.deps.workflowTemplateStore?.getEnabled()) ?? []).map((x) => x.slug).join(', ') || 'aucun'}.` };
      }
    }
  }

  /** The run a workflow thread's current turn started (`triggeredFrom: mention:<id>`). */
  async workflowRunOf(thread: AgentThreadEntity): Promise<WorkflowRunEntity | null> {
    if (!thread.currentMentionId || !this.deps.workflowRunStore) return null;
    const from = `mention:${thread.currentMentionId}`;
    return (await this.deps.workflowRunStore.getByTicket(thread.ticketId)).find((r) => r.triggeredFrom === from) ?? null;
  }

  private async activeWorkflowRun(ticketId: string): Promise<WorkflowRunEntity | null> {
    return (await this.deps.workflowRunStore?.getActiveByTicket(ticketId)) ?? null;
  }

  private async postAssistant(
    ticket: TicketEntity,
    assistant: AgentPersonaEntity,
    threadId: string | null,
    body: string,
    extra: { suppressMentionForAgents?: string[]; suppressAgentMentions?: boolean; questions?: AgentQuestion[] | null } = {},
  ) {
    const authorName = assistant.displayName || assistant.name;
    const result = await this.deps.postComment.execute({ ticketId: ticket.id, authorType: 'assistant', authorName, body, threadId, ...extra });
    const now = new Date();
    this.emit({
      type: 'comment.posted', commentId: result.comment.id, ticketId: ticket.id, authorType: 'assistant', authorName,
      createdMentions: result.createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
      occurredAt: now,
    });
    for (const m of result.createdMentions) {
      this.emit({ type: 'mention.created', mentionId: m.id, ticketId: ticket.id, targetAgent: m.targetAgent, targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now });
    }
    return result;
  }

  private emit(event: AnyDomainEvent): void {
    this.deps.eventBus.emit(event);
  }
}
