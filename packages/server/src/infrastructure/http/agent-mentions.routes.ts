import type { FastifyInstance } from 'fastify';
import { EVENT_TYPES } from '@asm/shared';
import { TicketNotFoundError, MentionNotFoundError, ForbiddenError } from '../../domain/errors.js';
import { createEvent } from '../../domain/events/create-event.js';
import type { Container } from '../container.js';

export function agentMentionsRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // Get pending mentions for the calling agent
    app.get<{
      Querystring: { ticket_id?: string };
    }>('/mentions/pending', async (request) => {
      const agentName = request.agent?.name ?? '';
      let mentions = await container.mentionStore.getPendingForAgent(agentName);

      if (request.query.ticket_id) {
        mentions = mentions.filter((m) => m.ticketId === request.query.ticket_id);
      }

      return mentions.map((m) => m.toDTO());
    });

    // Get all mentions for a ticket
    app.get<{
      Params: { id: string };
      Querystring: { status?: string; target_agent?: string; source_agent?: string };
    }>('/tickets/:id/mentions', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      let mentions = await container.mentionStore.getByTicket(request.params.id);

      if (request.query.status) {
        mentions = mentions.filter((m) => m.status === request.query.status);
      }
      if (request.query.target_agent) {
        mentions = mentions.filter((m) => m.targetAgent === request.query.target_agent);
      }
      if (request.query.source_agent) {
        mentions = mentions.filter((m) => m.sourceAgent === request.query.source_agent);
      }

      return mentions.map((m) => m.toDTO());
    });

    // Acknowledge a mention
    app.patch<{
      Params: { id: string };
    }>('/mentions/:id/acknowledge', async (request) => {
      const mention = await container.mentionStore.getById(request.params.id);
      if (!mention) throw new MentionNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? '';
      if (mention.targetAgent !== agentName) {
        throw new ForbiddenError(`Only ${mention.targetAgent} can acknowledge this mention`);
      }

      mention.acknowledge();
      await container.mentionStore.save(mention);

      const dto = mention.toDTO();
      container.ticketBroadcast('mention:acknowledged', dto);
      container.eventBus.emit(createEvent(EVENT_TYPES.MENTION_ACKNOWLEDGED, dto, { source: 'api', actor: agentName }));
      return dto;
    });

    // Resolve a mention
    app.patch<{
      Params: { id: string };
      Body: { commentId?: string; deliverableId?: string };
    }>('/mentions/:id/resolve', async (request) => {
      const agentName = request.agent?.name ?? '';

      await container.resolveMention.execute({
        mentionId: request.params.id,
        agentName,
        commentId: request.body?.commentId,
        deliverableId: request.body?.deliverableId,
      });

      const mention = (await container.mentionStore.getById(request.params.id))!;
      const dto = mention.toDTO();
      container.ticketBroadcast('mention:resolved', dto);
      container.eventBus.emit(createEvent(EVENT_TYPES.MENTION_RESOLVED, dto, { source: 'api', actor: agentName }));
      return dto;
    });
  };
}
