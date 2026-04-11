import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CreateTicketGroupRequest, UpdateTicketGroupRequest } from '@fleex/shared';
import { TicketGroupEntity } from '../../domain/entities/ticket-group.entity.js';
import type { Container } from '../container.js';

class TicketGroupNotFoundError extends Error {
  statusCode = 404;
  constructor(id: string) { super(`Ticket group not found: ${id}`); }
}

export function ticketGroupRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // ── Ticket Groups (Epics) ──

    app.get('/api/ticket-groups', async (request) => {
      const { boardId } = request.query as { boardId?: string };
      if (boardId) {
        const groups = await container.ticketGroupStore.getTicketGroupsByBoard(boardId);
        return groups.map((g) => g.toDTO());
      }
      const groups = await container.ticketGroupStore.getAllTicketGroups();
      return groups.map((g) => g.toDTO());
    });

    app.get<{ Params: { id: string } }>('/api/ticket-groups/:id', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      return group.toDTO();
    });

    app.post<{ Body: CreateTicketGroupRequest }>('/api/ticket-groups', async (request, reply) => {
      const group = TicketGroupEntity.create({
        id: randomUUID(),
        boardId: request.body.boardId,
        name: request.body.name,
        emoji: request.body.emoji,
        color: request.body.color,
        description: request.body.description,
        timeframe: request.body.timeframe,
      });
      await container.ticketGroupStore.saveTicketGroup(group);
      container.ticketBroadcast('ticketGroup:created', group.toDTO());
      return reply.code(201).send(group.toDTO());
    });

    app.patch<{ Params: { id: string }; Body: UpdateTicketGroupRequest }>('/api/ticket-groups/:id', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      group.update(request.body);
      await container.ticketGroupStore.saveTicketGroup(group);
      container.ticketBroadcast('ticketGroup:updated', group.toDTO());
      return group.toDTO();
    });

    app.post<{ Params: { id: string } }>('/api/ticket-groups/:id/archive', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      group.archive();
      await container.ticketGroupStore.saveTicketGroup(group);
      container.ticketBroadcast('ticketGroup:updated', group.toDTO());
      return group.toDTO();
    });

    app.post<{ Params: { id: string } }>('/api/ticket-groups/:id/unarchive', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      group.unarchive();
      await container.ticketGroupStore.saveTicketGroup(group);
      container.ticketBroadcast('ticketGroup:updated', group.toDTO());
      return group.toDTO();
    });

    app.delete<{ Params: { id: string } }>('/api/ticket-groups/:id', async (request, reply) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      await container.ticketGroupStore.removeTicketGroup(group.id);
      container.ticketBroadcast('ticketGroup:deleted', { id: group.id });
      return reply.code(204).send();
    });

    // ── Memberships (Ticket ↔ Epic) ──

    app.get<{ Params: { id: string } }>('/api/ticket-groups/:id/tickets', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      const memberships = await container.ticketGroupStore.getMembershipsByGroup(request.params.id);
      const tickets = await Promise.all(
        memberships.map((m) => container.ticketStore.getTicketById(m.ticketId)),
      );
      return tickets.filter(Boolean).map((t) => t!.toDTO());
    });

    app.post<{ Params: { id: string; ticketId: string } }>('/api/ticket-groups/:id/tickets/:ticketId', async (request, reply) => {
      await container.ticketGroupStore.addMembership(request.params.ticketId, request.params.id);
      container.ticketBroadcast('ticketGroup:memberAdded', {
        groupId: request.params.id,
        ticketId: request.params.ticketId,
      });
      return reply.code(201).send({ ticketId: request.params.ticketId, groupId: request.params.id });
    });

    app.delete<{ Params: { id: string; ticketId: string } }>('/api/ticket-groups/:id/tickets/:ticketId', async (request, reply) => {
      await container.ticketGroupStore.removeMembership(request.params.ticketId, request.params.id);
      container.ticketBroadcast('ticketGroup:memberRemoved', {
        groupId: request.params.id,
        ticketId: request.params.ticketId,
      });
      return reply.code(204).send();
    });

    // ── Get groups for a ticket ──

    app.get<{ Params: { ticketId: string } }>('/api/tickets/:ticketId/groups', async (request) => {
      const memberships = await container.ticketGroupStore.getMembershipsByTicket(request.params.ticketId);
      const groups = await Promise.all(
        memberships.map((m) => container.ticketGroupStore.getTicketGroupById(m.groupId)),
      );
      return groups.filter(Boolean).map((g) => g!.toDTO());
    });

    // ── Ticket Relationships (Parent ↔ Child) ──

    app.get<{ Params: { ticketId: string } }>('/api/tickets/:ticketId/children', async (request) => {
      const rels = await container.ticketGroupStore.getChildRelationships(request.params.ticketId);
      const children = await Promise.all(
        rels.map((r) => container.ticketStore.getTicketById(r.childId)),
      );
      return children.filter(Boolean).map((t) => t!.toDTO());
    });

    app.get<{ Params: { ticketId: string } }>('/api/tickets/:ticketId/parents', async (request) => {
      const rels = await container.ticketGroupStore.getParentRelationships(request.params.ticketId);
      const parents = await Promise.all(
        rels.map((r) => container.ticketStore.getTicketById(r.parentId)),
      );
      return parents.filter(Boolean).map((t) => t!.toDTO());
    });

    app.post<{ Params: { ticketId: string; childId: string } }>('/api/tickets/:ticketId/children/:childId', async (request, reply) => {
      const { ticketId, childId } = request.params;

      // Cycle prevention: check if childId is already an ancestor of ticketId
      if (ticketId === childId) {
        return reply.code(400).send({ error: 'A ticket cannot be its own child' });
      }
      if (await hasCycle(container, childId, ticketId)) {
        return reply.code(400).send({ error: 'This relationship would create a cycle' });
      }

      await container.ticketGroupStore.addRelationship(ticketId, childId);
      container.ticketBroadcast('ticketRelationship:created', {
        parentId: ticketId,
        childId,
      });
      return reply.code(201).send({ parentId: ticketId, childId });
    });

    app.delete<{ Params: { ticketId: string; childId: string } }>('/api/tickets/:ticketId/children/:childId', async (request, reply) => {
      await container.ticketGroupStore.removeRelationship(request.params.ticketId, request.params.childId);
      container.ticketBroadcast('ticketRelationship:deleted', {
        parentId: request.params.ticketId,
        childId: request.params.childId,
      });
      return reply.code(204).send();
    });
  };
}

// Cycle detection: BFS from `from` following parent edges to see if we reach `to`
async function hasCycle(container: Container, from: string, to: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = await container.ticketGroupStore.getChildRelationships(current);
    for (const c of children) {
      queue.push(c.childId);
    }
  }
  return false;
}
