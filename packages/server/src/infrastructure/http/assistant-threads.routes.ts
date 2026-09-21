import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { TicketNotFoundError } from '../../domain/errors.js';

type Deps = Pick<Container, 'ticketStore' | 'threadStore' | 'commentStore' | 'mentionStore' | 'postComment' | 'runAssistantTurn' | 'config' | 'eventBus'>;

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
        occurredAt: now,
      });
      for (const m of createdMentions) {
        container.eventBus.emit({
          type: 'mention.created', mentionId: m.id, ticketId: ticket.id, targetAgent: m.targetAgent,
          targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now,
        });
      }
      void container.runAssistantTurn.execute({ ticketId: ticket.id, trigger: { kind: 'user_message', commentId: comment.id } });
      return reply.code(201).send({
        comment: comment.toDTO(),
        assistant: { personaId: assistant.id, displayName: assistant.displayName || assistant.name },
      });
    });

    app.get<{ Params: { id: string } }>('/api/tickets/:id/threads', async (request) =>
      (await container.threadStore.getByTicket(request.params.id)).map((t) => t.toDTO()));

    app.get('/api/threads/open', async () => (await container.threadStore.getOpen()).map((t) => t.toDTO()));

    app.get<{ Params: { id: string } }>('/api/threads/:id', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      const turns = (await container.commentStore.getByTicket(thread.ticketId))
        .filter((c) => c.threadId === thread.id)
        .map((c) => c.toDTO());
      return { thread: thread.toDTO(), turns };
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
      const tag = `@agent:${thread.personaName}`;
      const body = waiting || request.body.body.includes(tag) ? request.body.body : `${tag} ${request.body.body}`;
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
      const now = new Date();
      for (const m of createdMentions) {
        if (m.targetAgent === thread.personaName) {
          thread.openTurn(m.id);
          await container.threadStore.save(thread);
        }
      }
      container.eventBus.emit({
        type: 'comment.posted', commentId: comment.id, ticketId: thread.ticketId, authorType: 'user', authorName,
        createdMentions: createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
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
      void container.runAssistantTurn.execute({ ticketId: thread.ticketId, trigger: { kind: 'conclude_request', threadId: thread.id } });
      return reply.code(202).send({ accepted: true });
    });
  };
}
