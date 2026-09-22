import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { TicketNotFoundError } from '../../domain/errors.js';

type Deps = Pick<Container, 'ticketStore' | 'threadStore' | 'commentStore' | 'mentionStore' | 'postComment' | 'runAssistantTurn' | 'executeAgent' | 'config' | 'eventBus'>;

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
      void container.runAssistantTurn.execute({ ticketId: ticket.id, trigger: { kind: 'user_message', commentId: comment.id } });
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

    // Read-repair: a thread still `running` while its mention is already settled
    // (missed event, older data) is parked idle / failed so the UI stays honest.
    async function reconcile(threads: Awaited<ReturnType<typeof container.threadStore.getByTicket>>) {
      for (const t of threads) {
        if (t.status !== 'running' || !t.currentMentionId) continue;
        const m = await container.mentionStore.getById(t.currentMentionId);
        if (!m) continue;
        if (m.status === 'pending') {
          // A new turn queued behind an older turn of the same thread still parked
          // in waiting_for_info (data from before the busy-agent guard): the older
          // one holds the (agent, ticket) lane forever. Close it so the new turn runs.
          const stale = (await container.mentionStore.getByTicket(t.ticketId)).filter((x) =>
            x.id !== m.id && x.targetAgent === t.personaName && x.status === 'waiting_for_info');
          let freed = false;
          for (const s of stale) {
            if ((await container.commentStore.getById(s.commentId))?.threadId !== t.id) continue;
            s.resolve();
            await container.mentionStore.save(s);
            container.eventBus.emit({ type: 'mention.resolved', mentionId: s.id, ticketId: t.ticketId, targetAgent: s.targetAgent, resolvedBy: 'system', occurredAt: new Date() });
            freed = true;
          }
          if (freed) container.executeAgent.execute(t.personaId).catch(() => {});
          continue;
        }
        let wake: 'resolved' | 'failed' | null = null;
        if (m.status === 'resolved') { t.markIdle(); wake = 'resolved'; }
        else if (m.status === 'failed') { t.fail(); wake = 'failed'; }
        else if (m.status === 'waiting_for_info') t.markWaiting();
        else continue;
        await container.threadStore.save(t);
        // The event that should have woken the assistant was missed: replay it.
        if (wake) void container.runAssistantTurn.execute({ ticketId: t.ticketId, trigger: { kind: 'thread_reply', threadId: t.id, mentionStatus: wake } });
      }
      return threads;
    }

    app.get<{ Params: { id: string } }>('/api/tickets/:id/threads', async (request) =>
      (await reconcile(await container.threadStore.getByTicket(request.params.id))).map((t) => t.toDTO()));

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
      void container.runAssistantTurn.execute({ ticketId: thread.ticketId, trigger: { kind: 'conclude_request', threadId: thread.id } });
      return reply.code(202).send({ accepted: true });
    });
  };
}
