import type { FastifyInstance } from 'fastify';
import { TicketNotFoundError, CommentNotFoundError, ForbiddenError } from '../../domain/errors.js';
import type { Container } from '../container.js';

export function agentCommentsRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {

    // List comments for a ticket
    app.get<{
      Params: { id: string };
      Querystring: { visibility?: string; since?: string; limit?: string; parentId?: string };
    }>('/tickets/:id/comments', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? '';
      let comments = (await container.commentStore.getByTicket(request.params.id))
        .filter((c) => c.isVisibleTo(agentName));

      if (request.query.visibility) {
        comments = comments.filter((c) => c.visibility === request.query.visibility);
      }
      if (request.query.since) {
        const since = new Date(request.query.since);
        comments = comments.filter((c) => c.createdAt >= since);
      }
      if (request.query.parentId) {
        comments = comments.filter((c) => c.parentId === request.query.parentId);
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      return comments.slice(-limit).map((c) => c.toDTO());
    });

    // Post a comment
    app.post<{
      Params: { id: string };
      Body: { body: string; visibility?: 'public' | 'private'; privateRecipients?: string[]; parentId?: string };
    }>('/tickets/:id/comments', async (request, reply) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? 'unknown';
      const { humanMentionName } = container.config.get();
      const { comment, createdMentions } = await container.postComment.execute({
        ticketId: request.params.id,
        authorType: 'agent',
        authorName: agentName,
        body: request.body.body,
        visibility: request.body.visibility,
        privateRecipients: request.body.privateRecipients,
        parentId: request.body.parentId,
        humanMentionNames: humanMentionName ? [humanMentionName] : [],
      });

      // Single event — the DomainEventListener handles broadcasting, auto-trigger, auto-review, wake
      emit({
        type: 'comment.posted',
        commentId: comment.id,
        ticketId: request.params.id,
        authorType: 'agent',
        authorName: agentName,
        createdMentions: createdMentions.map((m) => ({
          mentionId: m.id,
          targetAgent: m.targetAgent,
          targetType: m.targetType,
        })),
        occurredAt: new Date(),
      });

      for (const m of createdMentions) {
        emit({
          type: 'mention.created',
          mentionId: m.id,
          ticketId: request.params.id,
          targetAgent: m.targetAgent,
          targetType: m.targetType,
          sourceAgent: m.sourceAgent,
          occurredAt: new Date(),
        });
      }

      return reply.code(201).send({
        ...comment.toDTO(),
        createdMentions: createdMentions.map((m) => m.toDTO()),
      });
    });

    // Edit a comment
    app.patch<{
      Params: { id: string; commentId: string };
      Body: { body: string };
    }>('/tickets/:id/comments/:commentId', async (request) => {
      const existing = await container.commentStore.getById(request.params.commentId);
      if (!existing) throw new CommentNotFoundError(request.params.commentId);

      const agentName = request.agent?.name ?? '';
      if (existing.authorName !== agentName) {
        throw new ForbiddenError('Only the author can edit this comment');
      }

      const { humanMentionName } = container.config.get();
      const { comment, createdMentions, bodyChanged } = await container.editComment.execute({
        commentId: request.params.commentId,
        body: request.body.body,
        editorName: agentName,
        humanMentionNames: humanMentionName ? [humanMentionName] : [],
      });

      // Emit mention.created for newly added targets (auto-trigger + workflow)
      for (const m of createdMentions) {
        emit({
          type: 'mention.created',
          mentionId: m.id,
          ticketId: comment.ticketId,
          targetAgent: m.targetAgent,
          targetType: m.targetType,
          sourceAgent: agentName,
          occurredAt: new Date(),
        });
      }

      emit({
        type: 'comment.updated',
        commentId: comment.id,
        ticketId: comment.ticketId,
        createdMentions: createdMentions.map((m) => ({
          mentionId: m.id,
          targetAgent: m.targetAgent,
          targetType: m.targetType,
        })),
        editorType: 'agent',
        editorName: agentName,
        bodyChanged,
        editedAt: comment.lastEditedAt?.toISOString(),
        occurredAt: new Date(),
      });

      return comment.toDTO();
    });

    // Delete a comment
    app.delete<{
      Params: { id: string; commentId: string };
    }>('/tickets/:id/comments/:commentId', async (request, reply) => {
      const comment = await container.commentStore.getById(request.params.commentId);
      if (!comment) throw new CommentNotFoundError(request.params.commentId);

      const agentName = request.agent?.name ?? '';
      if (comment.authorName !== agentName) {
        throw new ForbiddenError('Only the author can delete this comment');
      }

      // Resolve any pending mentions from this comment
      const mentions = await container.mentionStore.getByComment(comment.id);
      for (const m of mentions) {
        if (m.status !== 'resolved') {
          m.resolve();
          await container.mentionStore.save(m);
        }
      }

      await container.commentStore.remove(comment.id);
      emit({ type: 'comment.deleted', commentId: comment.id, ticketId: comment.ticketId, occurredAt: new Date() });
      return reply.code(204).send();
    });
  };
}
