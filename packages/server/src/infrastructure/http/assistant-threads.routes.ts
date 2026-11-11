import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';
import { computeParticipants } from '../../application/use-cases/thread-label.js';
import { extractRequestedTargets } from '../../application/assistant/assistant-protocol.js';

type Deps = Pick<Container, 'ticketStore' | 'threadStore' | 'commentStore' | 'mentionStore' | 'postComment' | 'runAssistantTurn' | 'executeAgent' | 'generateThreadTitle' | 'config' | 'eventBus' | 'stopRun' | 'repairThreads'>;

/**
 * Work view Phase 3: the assistant entry point and the thread read/write routes.
 * The agent pipeline itself is untouched — a thread turn is a comment with a
 * `threadId`, and mentions flow through the existing `mention.created` path.
 */
export function assistantThreadsRoutes(container: Deps) {
  return async function (app: FastifyInstance) {
    // Work composer entry point: the user's comment + one assistant turn.
    app.post<{ Params: { id: string }; Body: { body: string } }>('/api/tickets/:id/assistant/messages', async (request, reply) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);
      const assistant = await container.runAssistantTurn.resolveAssistantPersona(ticket);
      // No assistant configured: the client falls back to a plain comment.
      if (!assistant) return reply.code(200).send({ comment: null, assistant: null });

      const { humanDisplayName, humanMentionName } = container.config.get();
      const authorName = humanDisplayName || humanMentionName || 'user';
      const { comment, createdMentions } = await container.postComment.execute({
        ticketId: ticket.id,
        authorType: 'user',
        authorName,
        body: request.body.body,
        visibility: 'public',
        humanMentionNames: humanMentionName ? [humanMentionName] : [],
        threadId: null,
        suppressAgentMentions: true,
      });
      const now = new Date();
      container.eventBus.emit({
        type: 'comment.posted', commentId: comment.id, ticketId: ticket.id, authorType: 'user', authorName,
        createdMentions: createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
        // Main stream: this message goes to the assistant; it must not wake a thread agent directly.
        threadId: null,
        occurredAt: now,
      });
      for (const m of createdMentions) {
        container.eventBus.emit({
          type: 'mention.created', mentionId: m.id, ticketId: ticket.id, targetAgent: m.targetAgent,
          targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now,
        });
      }
      // `@type:slug` in a message to the assistant is an order to delegate, not a
      // direct mention (none was created above): the turn receives the targets
      // and the server checks, at its end, that each valid one was handled.
      const requestedTargets = extractRequestedTargets(request.body.body);
      void container.runAssistantTurn.execute({ ticketId: ticket.id, trigger: { kind: 'user_message', commentId: comment.id, requestedTargets } });
      return reply.code(201).send({
        comment: comment.toDTO(),
        assistant: { personaId: assistant.id, displayName: assistant.displayName || assistant.name },
      });
    });

    // New task with "hand over to the assistant": one turn primed with the description.
    app.post<{ Params: { id: string } }>('/api/tickets/:id/assistant/start', async (request, reply) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);
      const assistant = await container.runAssistantTurn.resolveAssistantPersona(ticket);
      if (!assistant) return reply.code(200).send({ assistant: null });
      void container.runAssistantTurn.execute({ ticketId: ticket.id, trigger: { kind: 'ticket_created' } });
      return reply.code(202).send({ assistant: { personaId: assistant.id, displayName: assistant.displayName || assistant.name } });
    });

    /** DTOs with participants (authors of the thread's comments) computed at read time. */
    async function withParticipants(threads: AgentThreadEntity[]) {
      const commentsByTicket = new Map<string, Awaited<ReturnType<typeof container.commentStore.getByTicket>>>();
      for (const t of threads) {
        if (!commentsByTicket.has(t.ticketId)) commentsByTicket.set(t.ticketId, await container.commentStore.getByTicket(t.ticketId));
      }
      return threads.map((t) => ({ ...t.toDTO(), participants: computeParticipants(commentsByTicket.get(t.ticketId)!, t.id) }));
    }

    app.get<{ Params: { id: string } }>('/api/tickets/:id/threads', async (request) =>
      // Read-repair, shared with the periodic surveillance (`RepairThreadsUseCase`):
      // a thread still `running` while its run already settled is put right here too.
      withParticipants(await container.repairThreads.repair(await container.threadStore.getByTicket(request.params.id))));

    app.get('/api/threads/open', async () => withParticipants(await container.threadStore.getOpen()));

    app.get<{ Params: { id: string } }>('/api/threads/:id', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      const allComments = await container.commentStore.getByTicket(thread.ticketId);
      const turns = allComments
        .filter((c) => c.threadId === thread.id)
        .map((c) => c.toDTO());
      return { thread: { ...thread.toDTO(), participants: computeParticipants(allComments, thread.id) }, turns };
    });

    // "Step into the thread": a user turn. Wakes a waiting agent, or re-mentions it.
    app.post<{ Params: { id: string }; Body: { body: string } }>('/api/threads/:id/messages', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      if (thread.isTerminal) return reply.code(409).send({ error: 'Thread is closed' });
      const current = thread.currentMentionId ? await container.mentionStore.getById(thread.currentMentionId) : null;
      const waiting = current?.status === 'waiting_for_info';
      const { humanDisplayName, humanMentionName } = container.config.get();
      const authorName = humanDisplayName || humanMentionName || 'user';
      const tag = thread.mentionTag;
      // A persona is re-mentioned on each turn. A skill, panel or workflow only
      // re-runs when the user types its tag: a plain reply must not start a
      // second workflow run while the first waits on a gate.
      const retag = thread.targetType === 'agent' && !waiting && !request.body.body.includes(tag);
      const body = retag ? `${tag} ${request.body.body}` : request.body.body;
      const { comment, createdMentions } = await container.postComment.execute({
        ticketId: thread.ticketId,
        authorType: 'user',
        authorName,
        body,
        visibility: 'public',
        threadId: thread.id,
        humanMentionNames: humanMentionName ? [humanMentionName] : [],
        suppressMentionForAgents: waiting ? [thread.personaName] : [],
      });
      // Name the thread from its first user message, in the background (never blocks the reply).
      if (!thread.generatedTitle) container.generateThreadTitle.trigger(thread.id, request.body.body);
      const now = new Date();
      for (const m of createdMentions) {
        if (m.targetAgent === thread.personaName && m.targetType === thread.targetType) {
          thread.openTurn(m.id);
          await container.threadStore.save(thread);
        }
      }
      container.eventBus.emit({
        type: 'comment.posted', commentId: comment.id, ticketId: thread.ticketId, authorType: 'user', authorName,
        createdMentions: createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
        threadId: thread.id,
        occurredAt: now,
      });
      for (const m of createdMentions) {
        container.eventBus.emit({
          type: 'mention.created', mentionId: m.id, ticketId: thread.ticketId, targetAgent: m.targetAgent,
          targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now,
        });
      }
      return reply.code(201).send(comment.toDTO());
    });

    app.post<{ Params: { id: string } }>('/api/threads/:id/conclude', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      if (thread.isTerminal) return reply.code(409).send({ error: 'Thread is closed' });

      // The human concluding a thread stops the run still going in it — through
      // the single stop path, as the human. A workflow thread is left alone, as
      // before: its run may be parked on a decision only the human can take.
      const stopped = thread.targetType === 'workflow'
        ? []
        : (await container.stopRun.stopThread(thread, { by: 'user', reason: "thread conclu par l'utilisateur" })).executionIds;

      void container.runAssistantTurn.execute({ ticketId: thread.ticketId, trigger: { kind: 'conclude_request', threadId: thread.id } });
      return reply.code(202).send({ accepted: true, runsAutoTerminated: stopped.length });
    });

    // « Relancer »: the human lifts the hold their own stop had set, and asks the
    // assistant to put the thread back to work. Only this route, a human message
    // in the thread, or a later human message to the assistant lifts a hold.
    app.post<{ Params: { id: string } }>('/api/threads/:id/relaunch', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      if (thread.isTerminal) return reply.code(409).send({ error: 'Thread is closed' });
      if (thread.status === 'running') return reply.code(409).send({ error: 'Thread is already running' });
      if (thread.liftUserHold()) {
        await container.threadStore.save(thread);
        container.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
      }
      void container.runAssistantTurn.execute({ ticketId: thread.ticketId, trigger: { kind: 'relaunch_request', threadId: thread.id } });
      return reply.code(202).send({ accepted: true });
    });
  };
}
