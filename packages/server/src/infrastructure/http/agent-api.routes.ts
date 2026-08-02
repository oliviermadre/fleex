import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TicketStatus, UpdateTicketRequest } from '@fleex/shared';
import { TICKET_STATUSES } from '@fleex/shared';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { TicketActor } from '../../application/use-cases/ticket-actor.js';
import type { Container } from '../container.js';

export function agentApiRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  // Ticket writes on this API always come from an authenticated agent.
  const agentActor = (request: FastifyRequest): TicketActor => ({
    source: 'api',
    actorType: 'agent',
    actorName: request.agent?.name,
  });

  return async function (app: FastifyInstance) {

    // List boards
    app.get('/boards', async () => {
      const boards = await container.ticketStore.getAllBoards();
      return Promise.all(boards.map(async (b) => {
        const tickets = await container.ticketStore.getTicketsByBoard(b.id);
        const ticketCounts = {} as Record<TicketStatus, number>;
        for (const s of TICKET_STATUSES as readonly TicketStatus[]) {
          ticketCounts[s] = tickets.filter((t) => t.status === s).length;
        }
        return { ...b.toDTO(), ticketCounts };
      }));
    });

    // List/filter tickets
    app.get<{ Querystring: { board_id?: string; status?: TicketStatus } }>('/tickets', async (request) => {
      let tickets: TicketEntity[];
      if (request.query.board_id) {
        if (request.query.status) {
          tickets = await container.ticketStore.getTicketsByStatus(request.query.board_id, request.query.status);
        } else {
          tickets = await container.ticketStore.getTicketsByBoard(request.query.board_id);
        }
      } else {
        tickets = await container.ticketStore.getAllTickets();
      }
      return tickets.map((t) => t.toDTO());
    });

    // Get ticket
    app.get<{ Params: { id: string } }>('/tickets/:id', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);
      return ticket.toDTO();
    });

    // Create ticket
    app.post<{ Body: { boardId: string; title: string; description?: string; status?: TicketStatus; priority?: string; tags?: string[] } }>(
      '/tickets',
      async (request, reply) => {
        const { boardId, title, description, status, priority, tags } = request.body;
        const ticket = await container.createTicket.execute({
          boardId,
          title,
          description,
          status,
          priority: priority as TicketEntity['priority'],
          tags,
          actor: agentActor(request),
        });
        return reply.code(201).send(ticket.toDTO());
      },
    );

    // Update ticket
    app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/tickets/:id', async (request) => {
      const ticket = await container.updateTicket.execute({
        ticketId: request.params.id,
        changes: request.body as UpdateTicketRequest,
        actor: agentActor(request),
      });
      return ticket.toDTO();
    });

    // Delete ticket — goes through the use case so agent-side deletions reclaim
    // worktrees, sessions, files and the workspace folder like the web ones do.
    app.delete<{ Params: { id: string } }>('/tickets/:id', async (request, reply) => {
      await container.deleteTicket.execute({
        ticketId: request.params.id,
        actor: agentActor(request),
      });
      return reply.code(204).send();
    });

    // Claim ticket
    app.patch<{ Params: { id: string } }>('/tickets/:id/claim', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.agent?.name ?? 'unknown';
      const diff = ticket.claim(agentName);
      await container.ticketStore.saveTicket(ticket);

      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'assigned',
        changes: diff,
        source: 'api',
        actorType: 'agent',
        actorName: agentName,
      }));

      const dto = ticket.toDTO();
      emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
      return dto;
    });

    // Unclaim ticket
    app.patch<{ Params: { id: string } }>('/tickets/:id/unclaim', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const diff = ticket.unclaim();
      await container.ticketStore.saveTicket(ticket);

      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'assigned',
        changes: diff,
        source: 'api',
        actorType: 'agent',
        actorName: request.agent?.name,
      }));

      const dto = ticket.toDTO();
      emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
      return dto;
    });

    // Assign
    app.patch<{ Params: { id: string }; Body: { name: string } }>('/tickets/:id/assign', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const diff = ticket.assign(request.body.name);
      await container.ticketStore.saveTicket(ticket);

      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'assigned',
        changes: diff,
        source: 'api',
        actorType: 'agent',
        actorName: request.agent?.name,
      }));

      const dto = ticket.toDTO();
      emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
      return dto;
    });

    // Unassign
    app.patch<{ Params: { id: string } }>('/tickets/:id/unassign', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const diff = ticket.unassign();
      await container.ticketStore.saveTicket(ticket);

      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'assigned',
        changes: diff,
        source: 'api',
        actorType: 'agent',
        actorName: request.agent?.name,
      }));

      const dto = ticket.toDTO();
      emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
      return dto;
    });

    // Complete ticket (toggles done ⇄ doing)
    app.patch<{ Params: { id: string } }>('/tickets/:id/complete', async (request) => {
      const current = await container.ticketStore.getTicketById(request.params.id);
      if (!current) throw new TicketNotFoundError(request.params.id);

      const targetStatus: TicketStatus = current.status === 'done' ? 'doing' : 'done';
      const ticket = await container.moveTicket.execute({
        ticketId: request.params.id,
        toStatus: targetStatus,
        actor: agentActor(request),
      });
      return ticket.toDTO();
    });

    // Next ticket for agent
    app.get<{ Querystring: { board_id?: string } }>('/tickets/next', async (request) => {
      const ticket = await container.ticketStore.getNextTicketForAgent(request.query.board_id);
      if (!ticket) return { ticket: null };
      return { ticket: ticket.toDTO() };
    });

    // Agent's claimed tickets
    app.get('/tickets/pending', async (request) => {
      const agentName = request.agent?.name ?? '';
      const tickets = await container.ticketStore.getClaimedByAgent(agentName);
      return tickets.map((t) => t.toDTO());
    });

    // Agent settings
    app.get('/settings', async (request) => {
      return {
        name: request.agent?.name ?? '',
        status: 'active',
      };
    });

    app.patch('/settings', async (request) => {
      return { ok: true };
    });
  };
}
