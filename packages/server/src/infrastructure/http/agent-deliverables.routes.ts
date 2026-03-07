import type { FastifyInstance } from 'fastify';
import { TicketNotFoundError, DeliverableNotFoundError, ForbiddenError } from '../../domain/errors.js';
import type { Container } from '../container.js';

export function agentDeliverablesRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {

    // List deliverables for a ticket
    app.get<{
      Params: { id: string };
      Querystring: { agent_name?: string; type?: string; status?: string };
    }>('/tickets/:id/deliverables', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      let deliverables = await container.deliverableStore.getByTicket(request.params.id);

      if (request.query.agent_name) {
        deliverables = deliverables.filter((d) => d.agentName === request.query.agent_name);
      }
      if (request.query.type) {
        deliverables = deliverables.filter((d) => d.type === request.query.type);
      }
      if (request.query.status) {
        deliverables = deliverables.filter((d) => d.status === request.query.status);
      }

      return deliverables.map((d) => d.toDTO());
    });

    // Get a single deliverable
    app.get<{
      Params: { id: string; delivId: string };
    }>('/tickets/:id/deliverables/:delivId', async (request) => {
      const deliverable = await container.deliverableStore.getById(request.params.delivId);
      if (!deliverable) throw new DeliverableNotFoundError(request.params.delivId);
      return deliverable.toDTO();
    });

    // Submit a deliverable
    app.post<{
      Params: { id: string };
      Body: { type: string; title: string; content: string; status?: 'draft' | 'final'; mentionId?: string };
    }>('/tickets/:id/deliverables', async (request, reply) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? 'unknown';
      const deliverable = await container.submitDeliverable.execute({
        ticketId: request.params.id,
        agentName,
        type: request.body.type,
        title: request.body.title,
        content: request.body.content,
        status: request.body.status,
        mentionId: request.body.mentionId,
      });

      emit({
        type: 'deliverable.created',
        deliverableId: deliverable.id,
        ticketId: request.params.id,
        agentName,
        status: deliverable.status,
        occurredAt: new Date(),
      });

      return reply.code(201).send(deliverable.toDTO());
    });

    // Update a deliverable
    app.patch<{
      Params: { id: string; delivId: string };
      Body: { title?: string; content?: string; status?: 'draft' | 'final' };
    }>('/tickets/:id/deliverables/:delivId', async (request) => {
      const deliverable = await container.deliverableStore.getById(request.params.delivId);
      if (!deliverable) throw new DeliverableNotFoundError(request.params.delivId);

      const agentName = request.agent?.name ?? '';
      if (!deliverable.isOwnedBy(agentName)) {
        throw new ForbiddenError('Only the author can update this deliverable');
      }

      const oldStatus = deliverable.status;
      deliverable.update(request.body);
      await container.deliverableStore.save(deliverable);

      emit({
        type: 'deliverable.updated',
        deliverableId: deliverable.id,
        ticketId: deliverable.ticketId,
        agentName,
        oldStatus,
        newStatus: deliverable.status,
        occurredAt: new Date(),
      });

      return deliverable.toDTO();
    });
  };
}
