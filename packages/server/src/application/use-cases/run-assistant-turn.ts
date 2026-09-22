import { randomUUID } from 'node:crypto';
import type { AgentEventType, ConversationMode } from '@fleex/shared';
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
import { buildSdkOptions } from '../utils/build-sdk-options.js';
import { streamSdkQuery, type SdkQueryMetrics } from '../utils/stream-sdk-query.js';
import { buildExecutionStartData } from '../utils/build-execution-start-data.js';
import { resolveExecutionConfig } from '../utils/resolve-execution-config.js';
import {
  ASSISTANT_OUTPUT_SCHEMA,
  buildAssistantSystemPrompt,
  buildAssistantUserPrompt,
  parseAssistantOutput,
  renderQuestion,
  type AssistantAction,
  type AssistantTrigger,
} from '../assistant/assistant-protocol.js';

export const MAX_ASSISTANT_TURNS_PER_THREAD = 8;
/** Consecutive agent failures after which the assistant stops relaunching and reports back. */
export const MAX_THREAD_FAILURES = 3;

/** Runs one SDK query. Injected so tests can script the model's answer. */
export type SdkRunner = (p: {
  prompt: string;
  queryOptions: Record<string, unknown>;
  emitEvent: (t: AgentEventType, d: unknown) => Promise<void> | void;
  onSessionId: (sid: string) => void;
}) => Promise<{ resultText: string; structuredOutput: Record<string, unknown> | null; metrics: SdkQueryMetrics }>;

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
}

/**
 * One assistant turn: read the ticket, ask the assistant persona for exactly one
 * action, apply it. Turns on the same ticket are serialised; nothing here loops —
 * the next turn only comes from a new event (user message, agent reply, conclude).
 */
export class RunAssistantTurnUseCase {
  /** Set by the WS plugin to stream agent events live (same as ExecuteAgent). */
  public onEvent: ((event: AgentEventEntity) => void) | null = null;
  private lanes = new Map<string, Promise<void>>();
  private sessions = new Map<string, string>(); // `${personaId}:${ticketId}` → sdk session id
  private sessionsLoaded = false;

  constructor(
    private readonly deps: RunAssistantTurnDeps,
    private sdkRunner: SdkRunner = (p) =>
      streamSdkQuery({ prompt: p.prompt, queryOptions: p.queryOptions, emitEvent: p.emitEvent, onSessionId: p.onSessionId }),
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

    const [context, allThreads, personas] = await Promise.all([
      this.deps.getTicketContext.execute({ ticketId, agentName: assistant.name }),
      this.deps.threadStore.getByTicket(ticketId),
      this.deps.personaStore.getAll(),
    ]);
    const threadId = trigger.kind === 'user_message' || trigger.kind === 'ticket_created' ? null : trigger.threadId;
    const turns = threadId ? context.comments.filter((c) => c.threadId === threadId) : [];

    const systemPrompt = buildAssistantSystemPrompt({
      persona: assistant,
      assistantName: assistant.displayName || assistant.name,
      personas: personas
        .filter((p) => p.id !== assistant.id)
        .map((p) => ({ name: p.name, displayName: p.displayName, identityMd: p.identityMd })),
    });
    const prompt = buildAssistantUserPrompt({ context, threads: allThreads.map((t) => t.toDTO()), trigger, turns });

    const resolved = resolveExecutionConfig(assistant, ticket, this.deps.logger);
    const sessionKey = `${assistant.id}:${ticketId}`;
    const previousSessionId = await this.previousSession(sessionKey);
    const executionId = randomUUID();
    const mentionKey = `assistant:${randomUUID()}`;

    await this.deps.agentEventStore.startExecution({
      executionId,
      personaId: assistant.id,
      ticketId,
      mentionId: mentionKey,
      model: resolved.model,
      effort: resolved.effort,
      fast: resolved.fast,
    });
    let sequence = 0;
    const emitEvent = async (eventType: AgentEventType, data: unknown) => {
      const event = AgentEventEntity.create({ executionId, eventType, data, sequence: sequence++ });
      await this.deps.agentEventStore.appendEvent(event);
      this.onEvent?.(event);
    };
    await emitEvent('execution_start', buildExecutionStartData({
      executionId,
      personaId: assistant.id,
      personaName: assistant.name,
      ticketId,
      mentionId: mentionKey,
      model: resolved.model,
      effectiveMode: 'talk',
      worktreePath: null,
      resumeSessionId: previousSessionId ?? null,
      kind: 'assistant',
      maxTurns: 0,
      systemPromptSections: ['Assistant protocol'],
      systemPromptLength: systemPrompt.length,
      userPromptLength: prompt.length,
      ticketTitle: context.ticket.title,
      ticketStatus: context.ticket.status,
      commentsCount: context.comments.length,
      deliverablesCount: context.deliverables.length,
    }));

    const queryOptions = buildSdkOptions('talk', {
      model: resolved.model,
      systemPrompt,
      outputFormat: ASSISTANT_OUTPUT_SCHEMA,
      effort: resolved.effort,
      fast: resolved.fast,
      maxTurns: this.deps.config.get().agentMaxTurns,
    });
    // talk mode never sets resume itself; the assistant keeps one session per ticket.
    if (previousSessionId) queryOptions.resume = previousSessionId;

    let action: AssistantAction | null = null;
    try {
      const result = await this.sdkRunner({
        prompt,
        queryOptions,
        emitEvent,
        onSessionId: (sid) => {
          this.sessions.set(sessionKey, sid);
          void this.deps.agentEventStore.updateSessionId(executionId, sid);
        },
      });
      action = parseAssistantOutput(result.structuredOutput, result.resultText);
      await this.deps.agentEventStore.completeExecution(executionId, 'completed', {
        model: resolved.model, effectiveMode: 'talk', ...result.metrics,
      });
      await emitEvent('execution_end', { status: 'completed', ticketId, effectiveMode: 'talk', model: resolved.model, ...result.metrics });
    } catch (err) {
      await this.deps.agentEventStore.completeExecution(executionId, 'failed', { model: resolved.model, effectiveMode: 'talk' });
      await emitEvent('execution_end', {
        status: 'failed', ticketId, effectiveMode: 'talk', model: resolved.model,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (trigger.kind === 'conclude_request') action = this.forceConclude(trigger.threadId, action);

    if (!action) {
      this.deps.logger.warn('Assistant produced no usable action', { ticketId, executionId });
      await this.postAssistant(ticket, assistant, null, "Je n'ai pas pu traiter ce message. Reformule, ou réessaie.");
      return;
    }
    await this.apply(ticket, assistant, action, allThreads);
  }

  private forceConclude(threadId: string, action: AssistantAction | null): AssistantAction {
    if (action?.action === 'conclude_thread') return { ...action, threadId };
    const fromMessage: string | null =
      action && (action.action === 'reply' || action.action === 'delegate') ? action.message : null;
    const summary = fromMessage || "Thread conclu à la demande de l'utilisateur.";
    return { action: 'conclude_thread', threadId, summary, message: null, question: null };
  }

  private async apply(
    ticket: TicketEntity,
    assistant: AgentPersonaEntity,
    action: AssistantAction,
    threads: AgentThreadEntity[],
  ): Promise<void> {
    switch (action.action) {
      case 'reply':
        await this.postAssistant(ticket, assistant, null, action.message + renderQuestion(action.question));
        return;

      case 'delegate': {
        await this.applyMode(ticket, action.mode);
        const open = threads.find((t) => t.personaName === action.personaName && !t.isTerminal);
        if (open) {
          await this.continueThread(ticket, assistant, open, action.turn);
          return;
        }
        const target = await this.deps.personaStore.getByName(action.personaName);
        if (!target) {
          await this.postAssistant(ticket, assistant, null, `Je ne connais pas de persona « ${action.personaName} ».`);
          return;
        }
        if (action.message) await this.postAssistant(ticket, assistant, null, action.message);
        const thread = AgentThreadEntity.create({
          id: randomUUID(),
          ticketId: ticket.id,
          personaId: target.id,
          personaName: target.name,
          assistantPersonaId: assistant.id,
          brief: action.brief,
          forwardedContext: action.forward,
        });
        await this.deps.threadStore.save(thread);
        this.emit({ type: 'thread.created', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        await this.openTurn(ticket, assistant, thread, action.turn);
        return;
      }

      case 'continue_thread': {
        await this.applyMode(ticket, action.mode);
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread || thread.isTerminal) {
          await this.postAssistant(ticket, assistant, null, 'Ce thread est déjà clos.');
          return;
        }
        await this.continueThread(ticket, assistant, thread, action.turn);
        return;
      }

      case 'conclude_thread': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread || thread.isTerminal) return;
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
            this.emit({
              type: 'mention.resolved', mentionId, ticketId: ticket.id, targetAgent: mention.targetAgent,
              resolvedBy: assistant.name, occurredAt: new Date(),
            });
          }
        }
        const who = target?.displayName || thread.personaName;
        const lead = action.message ? `${action.message}\n\n` : '';
        await this.postAssistant(ticket, assistant, null, `${lead}Retour de ${who} : ${action.summary}${renderQuestion(action.question)}`);
        this.emit({ type: 'thread.concluded', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        return;
      }
    }
  }

  /**
   * The agents' tool rights are the ticket's conversation mode, resolved when a
   * mention is acknowledged or woken. The assistant owns that decision: setting
   * it here, before the turn, is the only real way to "grant" Write/Bash.
   */
  private async applyMode(ticket: TicketEntity, mode: ConversationMode | null): Promise<void> {
    if (!mode || ticket.conversationMode === mode) return;
    const diff = ticket.updateExecutionConfig({ conversationMode: mode });
    await this.deps.ticketStore.saveTicket(ticket);
    this.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
  }

  /** Assistant turn inside a thread: wake a waiting mention, or open a new one. */
  private async continueThread(
    ticket: TicketEntity,
    assistant: AgentPersonaEntity,
    thread: AgentThreadEntity,
    turn: string,
  ): Promise<void> {
    if (thread.status === 'failed' && thread.failures >= MAX_THREAD_FAILURES) {
      await this.apply(ticket, assistant, {
        action: 'conclude_thread', threadId: thread.id, question: null,
        message: `Je n'arrive pas à faire aboutir ${thread.personaName} sur ce point après ${thread.failures} tentatives.`,
        summary: `Abandon après ${thread.failures} échecs consécutifs de l'agent. À reprendre autrement.`,
      }, [thread]);
      return;
    }
    const assistantTurns = (await this.deps.commentStore.getByTicket(ticket.id))
      .filter((c) => c.threadId === thread.id && c.authorType === 'assistant').length;
    if (assistantTurns >= MAX_ASSISTANT_TURNS_PER_THREAD) {
      await this.apply(ticket, assistant, {
        action: 'conclude_thread', threadId: thread.id, message: null, question: null,
        summary: `Thread interrompu après ${assistantTurns} échanges sans conclusion.`,
      }, [thread]);
      return;
    }
    const current = thread.currentMentionId ? await this.deps.mentionStore.getById(thread.currentMentionId) : null;
    if (current && current.status === 'waiting_for_info') {
      // Answer the agent's question on the same mention, resumed session.
      await this.postAssistant(ticket, assistant, thread.id, `@agent:${thread.personaName} ${turn}`, {
        suppressMentionForAgents: [thread.personaName],
      });
      thread.recordTurn();
      thread.markRunning();
      await this.deps.threadStore.save(thread);
      // ExecuteAgent auto-blocked the ticket when the agent asked; the assistant
      // answering is the answer, so the block lifts without the user's help.
      if (ticket.blocked) {
        ticket.update({ blocked: false });
        await this.deps.ticketStore.saveTicket(ticket);
        this.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: { blocked: { from: true, to: false } }, occurredAt: new Date() });
      }
      await this.deps.executeAgent.wakeUp(current);
      this.emit({ type: 'thread.updated', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
      return;
    }
    await this.openTurn(ticket, assistant, thread, turn);
  }

  /** Post `@agent:<persona> <turn>` in the thread → new mention → ExecuteAgent. */
  private async openTurn(
    ticket: TicketEntity,
    assistant: AgentPersonaEntity,
    thread: AgentThreadEntity,
    turn: string,
  ): Promise<void> {
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
    const result = await this.deps.postComment.execute({
      ticketId: ticket.id, authorType: 'assistant', authorName, body, threadId, ...extra,
    });
    const now = new Date();
    this.emit({
      type: 'comment.posted',
      commentId: result.comment.id,
      ticketId: ticket.id,
      authorType: 'assistant',
      authorName,
      createdMentions: result.createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
      occurredAt: now,
    });
    for (const m of result.createdMentions) {
      this.emit({
        type: 'mention.created', mentionId: m.id, ticketId: ticket.id, targetAgent: m.targetAgent,
        targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now,
      });
    }
    return result;
  }

  private async previousSession(key: string): Promise<string | undefined> {
    if (!this.sessionsLoaded) {
      this.sessionsLoaded = true;
      for (const [k, v] of await this.deps.agentEventStore.getSessionHistory()) {
        if (!this.sessions.has(k)) this.sessions.set(k, v.sdkSessionId);
      }
    }
    return this.sessions.get(key);
  }

  private emit(event: AnyDomainEvent): void {
    this.deps.eventBus.emit(event);
  }
}
