import type { MentionTargetType } from '@fleex/shared';

import { TicketNotFoundError, CommentNotFoundError, ForbiddenError } from '../../domain/errors.js';

import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

export function agentCommentsRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) =>
    container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {
    // List comments for a ticket
    app.get<{
      Params: { id: string };
      Querystring: { visibility?: string; since?: string; limit?: string; parentId?: string };
    }>('/tickets/:id/comments', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? '';
      let comments = (await container.commentStore.getByTicket(request.params.id)).filter((c) =>
        c.isVisibleTo(agentName),
      );

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
      Body: {
        body: string;
        visibility?: 'public' | 'private';
        privateRecipients?: string[];
        parentId?: string;
      };
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
      const comment = await container.commentStore.getById(request.params.commentId);
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
      const existingMentions = await container.mentionStore.getByComment(comment.id);
      for (const m of existingMentions) {
        if (!newMentionNames.has(m.targetAgent) && m.status !== 'resolved') {
          m.resolve();
          await container.mentionStore.save(m);
        }
      }

      // Create mentions for newly added targets
      const { randomUUID } = await import('node:crypto');
      const { TicketMentionEntity } =
        await import('../../domain/entities/ticket-mention.entity.js');
      const { humanMentionName } = container.config.get();
      const newlyCreatedMentions: Array<{
        mentionId: string;
        targetAgent: string;
        targetType: MentionTargetType;
      }> = [];

      for (const target of newMentionNames) {
        if (!oldMentions.has(target) && target !== agentName) {
          const isHuman = humanMentionName && target === humanMentionName;

          const mention = TicketMentionEntity.create({
            id: randomUUID(),
            ticketId: comment.ticketId,
            commentId: comment.id,
            targetAgent: target,
            sourceAgent: agentName,
            targetType: isHuman ? 'human' : 'agent',
          });
          await container.mentionStore.save(mention);
          newlyCreatedMentions.push({
            mentionId: mention.id,
            targetAgent: mention.targetAgent,
            targetType: mention.targetType,
          });

          // Emit mention.created for auto-trigger and workflow
          emit({
            type: 'mention.created',
            mentionId: mention.id,
            ticketId: comment.ticketId,
            targetAgent: mention.targetAgent,
            targetType: mention.targetType,
            sourceAgent: agentName,
            occurredAt: new Date(),
          });
        }
      }

      // Emit comment.updated with newly created mentions for workflow
      emit({
        type: 'comment.updated',
        commentId: comment.id,
        ticketId: comment.ticketId,
        createdMentions: newlyCreatedMentions,
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
      emit({
        type: 'comment.deleted',
        commentId: comment.id,
        ticketId: comment.ticketId,
        occurredAt: new Date(),
      });
      return reply.code(204).send();
    });
  };
}
