import type { FastifyInstance } from 'fastify';
import { TicketNotFoundError, CommentNotFoundError, ForbiddenError } from '../../domain/errors.js';
import type { Container } from '../container.js';

export function agentCommentsRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // List comments for a ticket
    app.get<{
      Params: { id: string };
      Querystring: { visibility?: string; since?: string; limit?: string; parentId?: string };
    }>('/tickets/:id/comments', async (request) => {
      const ticket = container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? '';
      let comments = container.commentStore.getByTicket(request.params.id)
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
      const ticket = container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? 'unknown';
      const { comment, createdMentions } = await container.postComment.execute({
        ticketId: request.params.id,
        authorType: 'agent',
        authorName: agentName,
        body: request.body.body,
        visibility: request.body.visibility,
        privateRecipients: request.body.privateRecipients,
        parentId: request.body.parentId,
      });

      const dto = comment.toDTO();
      container.ticketBroadcast('comment:created', dto);

      for (const mention of createdMentions) {
        container.ticketBroadcast('mention:created', mention.toDTO());
      }

      return reply.code(201).send({
        ...dto,
        createdMentions: createdMentions.map((m) => m.toDTO()),
      });
    });

    // Edit a comment
    app.patch<{
      Params: { id: string; commentId: string };
      Body: { body: string };
    }>('/tickets/:id/comments/:commentId', async (request) => {
      const comment = container.commentStore.getById(request.params.commentId);
      if (!comment) throw new CommentNotFoundError(request.params.commentId);

      const agentName = request.agent?.name ?? '';
      if (comment.authorName !== agentName) {
        throw new ForbiddenError('Only the author can edit this comment');
      }

      const oldMentions = new Set(comment.mentions);
      comment.updateBody(request.body.body);
      await container.commentStore.save(comment);

      // Reconcile mentions: remove old, create new
      const newMentionNames = new Set(comment.mentions);

      // Remove mentions for agents no longer mentioned
      const existingMentions = container.mentionStore.getByComment(comment.id);
      for (const m of existingMentions) {
        if (!newMentionNames.has(m.targetAgent) && m.status !== 'resolved') {
          m.resolve();
          await container.mentionStore.save(m);
        }
      }

      // Create mentions for newly added agents
      const { randomUUID } = await import('node:crypto');
      const { TicketMentionEntity } = await import('../../domain/entities/ticket-mention.entity.js');
      for (const target of newMentionNames) {
        if (!oldMentions.has(target) && target !== agentName) {
          const mention = TicketMentionEntity.create({
            id: randomUUID(),
            ticketId: comment.ticketId,
            commentId: comment.id,
            targetAgent: target,
            sourceAgent: agentName,
          });
          await container.mentionStore.save(mention);
          container.ticketBroadcast('mention:created', mention.toDTO());
        }
      }

      const dto = comment.toDTO();
      container.ticketBroadcast('comment:updated', dto);
      return dto;
    });

    // Delete a comment
    app.delete<{
      Params: { id: string; commentId: string };
    }>('/tickets/:id/comments/:commentId', async (request, reply) => {
      const comment = container.commentStore.getById(request.params.commentId);
      if (!comment) throw new CommentNotFoundError(request.params.commentId);

      const agentName = request.agent?.name ?? '';
      if (comment.authorName !== agentName) {
        throw new ForbiddenError('Only the author can delete this comment');
      }

      // Resolve any pending mentions from this comment
      const mentions = container.mentionStore.getByComment(comment.id);
      for (const m of mentions) {
        if (m.status !== 'resolved') {
          m.resolve();
          await container.mentionStore.save(m);
        }
      }

      await container.commentStore.remove(comment.id);
      container.ticketBroadcast('comment:deleted', { id: comment.id, ticketId: comment.ticketId });
      return reply.code(204).send();
    });
  };
}
