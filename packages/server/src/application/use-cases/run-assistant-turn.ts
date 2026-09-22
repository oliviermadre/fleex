import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEventType } from '@fleex/shared';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { ThreadStorePort } from '../ports/thread-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';
import type { AnyDomainEvent } from '../../domain/events.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { GetTicketContextUseCase } from './get-ticket-context.js';
import type { ExecuteAgentUseCase } from './execute-agent.js';
import { buildExecutionStartData } from '../utils/build-execution-start-data.js';
import type { AssistantEnvironmentPort } from '../assistant/assistant-environment.js';
import type { AssistantLlm } from '../assistant/assistant-llm.js';
import { cliToolArgv, cliToolsToAnthropic, type CliTool } from '../assistant/fleex-cli-tools.js';
import {
  ACTION_TOOLS,
  buildAssistantSystemPrompt,
  buildAssistantUserPrompt,
  parseActionToolInput,
  renderQuestion,
  type AssistantAction,
  type AssistantTrigger,
} from '../assistant/assistant-protocol.js';

export const MAX_ASSISTANT_TURNS_PER_THREAD = 8;
/** Consecutive agent failures after which the assistant stops relaunching and reports back. */
export const MAX_THREAD_FAILURES = 3;
/** Tool rounds one assistant turn may take before it must answer. */
export const ASSISTANT_MAX_ROUNDS = 8;

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
  postComment: PostCommentUseCase;
  getTicketContext: GetTicketContextUseCase;
  agentEventStore: AgentEventStorePort;
  executeAgent: Pick<ExecuteAgentUseCase, 'cancelExecutionForMention' | 'wakeUp'>;
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

  async resolveAssistantPersona(ticket: TicketEntity): Promise<AgentPersonaEntity | null> {
    const id = ticket.assistantPersonaId ?? this.deps.config.get().defaultAssistantPersonaId ?? null;
    return id ? this.deps.personaStore.getById(id) : null;
  }

  execute(params: { ticketId: string; trigger: AssistantTrigger }): Promise<void> {
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

    const [context, allThreads, personas, cliTools] = await Promise.all([
      this.deps.getTicketContext.execute({ ticketId, agentName: assistant.name }),
      this.deps.threadStore.getByTicket(ticketId),
      this.deps.personaStore.getAll(),
      this.deps.environment.cliTools(),
    ]);
    const threadId = trigger.kind === 'user_message' || trigger.kind === 'ticket_created' ? null : trigger.threadId;
    const turns = threadId ? context.comments.filter((c) => c.threadId === threadId) : [];
    let threadDeliverables: typeof context.deliverables = [];
    if (threadId && turns.length > 0) {
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
    });
    const userPrompt = buildAssistantUserPrompt({ context, threads: allThreads.map((t) => t.toDTO()), trigger, turns, threadDeliverables });
    const model = ticket.modelOverride ?? assistant.model;
    const tools = [...ACTION_TOOLS, ...cliToolsToAnthropic(cliTools)] as Anthropic.Tool[];
    const cliByName = new Map(cliTools.map((t) => [t.name, t]));

    // ── Execution log (run card + view log), same plumbing as agent runs ──
    const executionId = randomUUID();
    const mentionKey = `assistant:${randomUUID()}`;
    await this.deps.agentEventStore.startExecution({ executionId, personaId: assistant.id, ticketId, mentionId: mentionKey, model });
    let sequence = 0;
    const emitEvent = async (eventType: AgentEventType, data: unknown) => {
      const event = AgentEventEntity.create({ executionId, eventType, data, sequence: sequence++ });
      await this.deps.agentEventStore.appendEvent(event);
      this.onEvent?.(event);
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
    const usage = { inputTokens: 0, outputTokens: 0 };
    let finalText = '';
    let concluded = false;
    let threadActionTaken = false;
    let threads = allThreads;

    try {
      for (let round = 0; round < ASSISTANT_MAX_ROUNDS; round++) {
        let roundText = '';
        const res = await this.llm({ model, system, messages, tools }, (delta) => {
          roundText += delta;
          void emitEvent('content_block_delta', { type: 'assistant', message: { content: [{ type: 'text', text: delta }] } });
        });
        usage.inputTokens += res.usage?.inputTokens ?? 0;
        usage.outputTokens += res.usage?.outputTokens ?? 0;
        messages.push({ role: 'assistant', content: res.content });

        const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0) {
          finalText = roundText.trim() || res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
          break;
        }
        if (roundText.trim()) finalText = roundText.trim(); // text before a tool call: keep the last one

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
              text = await this.apply(ticket, assistant, action, threads);
              threadActionTaken = true;
              if (action.action === 'conclude_thread') concluded = true;
            }
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
          } else if (call.name in { delegate_to_persona: 1, continue_thread: 1, conclude_thread: 1, request_mode: 1 }) {
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
        }, threads);
        finalText = '';
      }

      if (finalText) {
        await this.postAssistant(ticket, assistant, null, finalText);
      } else if (!threadActionTaken) {
        this.deps.logger.warn('Assistant produced neither text nor action', { ticketId, executionId });
        await this.postAssistant(ticket, assistant, null, "Je n'ai pas pu traiter ce message. Reformule, ou réessaie.");
      }

      await this.deps.agentEventStore.completeExecution(executionId, 'completed', { model, effectiveMode: 'talk', ...usage });
      await emitEvent('execution_end', { status: 'completed', ticketId, effectiveMode: 'talk', model, ...usage });
    } catch (err) {
      await this.deps.agentEventStore.completeExecution(executionId, 'failed', { model, effectiveMode: 'talk' });
      await emitEvent('execution_end', { status: 'failed', ticketId, effectiveMode: 'talk', model, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Applies one thread action and returns the tool result the model reads back. */
  private async apply(
    ticket: TicketEntity,
    assistant: AgentPersonaEntity,
    action: AssistantAction,
    threads: AgentThreadEntity[],
  ): Promise<string> {
    switch (action.action) {
      case 'reply':
        await this.postAssistant(ticket, assistant, null, action.message + renderQuestion(action.question));
        return 'Message posté.';

      case 'delegate': {
        const open = threads.find((t) => t.personaName === action.personaName && !t.isTerminal);
        if (open) return this.continueThread(ticket, assistant, open, action.turn);
        const target = await this.deps.personaStore.getByName(action.personaName);
        if (!target) return `Persona inconnue : « ${action.personaName} ». Personas disponibles : ${(await this.deps.personaStore.getAll()).map((p) => p.name).join(', ')}.`;
        if (action.message) await this.postAssistant(ticket, assistant, null, action.message);
        const thread = AgentThreadEntity.create({
          id: randomUUID(), ticketId: ticket.id, personaId: target.id, personaName: target.name,
          assistantPersonaId: assistant.id, brief: action.brief, forwardedContext: action.forward,
        });
        await this.deps.threadStore.save(thread);
        this.emit({ type: 'thread.created', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        await this.openTurn(ticket, assistant, thread, action.turn);
        return `Thread ${thread.id} ouvert avec ${target.displayName || target.name} ; l'agent a été lancé. Tu seras rappelé quand il aura répondu.`;
      }

      case 'continue_thread': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread) return `Thread inconnu : ${action.threadId}.`;
        if (thread.isTerminal) return 'Ce thread est déjà clos.';
        return this.continueThread(ticket, assistant, thread, action.turn);
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
        const target = await this.deps.personaStore.getByName(thread.personaName);
        const mentionId = thread.currentMentionId;
        thread.conclude(action.summary);
        await this.deps.threadStore.save(thread);
        if (mentionId) {
          const mention = await this.deps.mentionStore.getById(mentionId);
          if (mention && mention.status !== 'resolved') {
            await this.deps.executeAgent.cancelExecutionForMention(mentionId);
            mention.resolve();
            await this.deps.mentionStore.save(mention);
            this.emit({ type: 'mention.resolved', mentionId, ticketId: ticket.id, targetAgent: mention.targetAgent, resolvedBy: assistant.name, occurredAt: new Date() });
          }
        }
        const who = target?.displayName || thread.personaName;
        const lead = action.message ? `${action.message}\n\n` : '';
        await this.postAssistant(ticket, assistant, null, `${lead}Retour de ${who} : ${action.summary}${renderQuestion(action.question)}`);
        this.emit({ type: 'thread.concluded', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        return `Thread conclu ; le résumé a été posté dans le fil.`;
      }
    }
  }

  /** Assistant turn inside a thread: wake a waiting mention, or open a new one. */
  private async continueThread(ticket: TicketEntity, assistant: AgentPersonaEntity, thread: AgentThreadEntity, turn: string): Promise<string> {
    if (thread.status === 'failed' && thread.failures >= MAX_THREAD_FAILURES) {
      return this.apply(ticket, assistant, {
        action: 'conclude_thread', threadId: thread.id, question: null,
        message: `Je n'arrive pas à faire aboutir ${thread.personaName} sur ce point après ${thread.failures} tentatives.`,
        summary: `Abandon après ${thread.failures} échecs consécutifs de l'agent. À reprendre autrement.`,
      }, [thread]);
    }
    const assistantTurns = (await this.deps.commentStore.getByTicket(ticket.id))
      .filter((c) => c.threadId === thread.id && c.authorType === 'assistant').length;
    if (assistantTurns >= MAX_ASSISTANT_TURNS_PER_THREAD) {
      return this.apply(ticket, assistant, {
        action: 'conclude_thread', threadId: thread.id, message: null, question: null,
        summary: `Thread interrompu après ${assistantTurns} échanges sans conclusion.`,
      }, [thread]);
    }
    const current = thread.currentMentionId ? await this.deps.mentionStore.getById(thread.currentMentionId) : null;
    if (current && current.status === 'waiting_for_info') {
      await this.postAssistant(ticket, assistant, thread.id, `@agent:${thread.personaName} ${turn}`, { suppressMentionForAgents: [thread.personaName] });
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

  private async openTurn(ticket: TicketEntity, assistant: AgentPersonaEntity, thread: AgentThreadEntity, turn: string): Promise<void> {
    const { createdMentions } = await this.postAssistant(ticket, assistant, thread.id, `@agent:${thread.personaName} ${turn}`);
    const mention = createdMentions.find((m) => m.targetAgent === thread.personaName);
    if (mention) thread.openTurn(mention.id);
    else thread.recordTurn();
    await this.deps.threadStore.save(thread);
    this.emit({ type: 'thread.updated', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
  }

  private async postAssistant(
    ticket: TicketEntity,
    assistant: AgentPersonaEntity,
    threadId: string | null,
    body: string,
    extra: { suppressMentionForAgents?: string[] } = {},
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
