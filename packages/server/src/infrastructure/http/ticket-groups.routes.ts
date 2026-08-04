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
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {

    // ── Ticket Groups (Epics) ──

    app.get('/api/epics', async (request) => {
      const { boardId } = request.query as { boardId?: string };
      if (boardId) {
        const groups = await container.ticketGroupStore.getTicketGroupsByBoard(boardId);
        return groups.map((g) => g.toDTO());
      }
      const groups = await container.ticketGroupStore.getAllTicketGroups();
      return groups.map((g) => g.toDTO());
    });

    app.get<{ Params: { id: string } }>('/api/epics/:id', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      return group.toDTO();
    });

    app.post<{ Body: CreateTicketGroupRequest }>('/api/epics', async (request, reply) => {
      const boardIds = request.body.boardIds ?? (request.body.boardId ? [request.body.boardId] : []);
      const group = TicketGroupEntity.create({
        id: randomUUID(),
        boardIds,
        name: request.body.name,
        emoji: request.body.emoji,
        color: request.body.color,
        description: request.body.description,
        timeframe: request.body.timeframe,
      });
      await container.ticketGroupStore.saveTicketGroup(group);
      emit({ type: 'ticketGroup.created', groupId: group.id, boardId: group.boardId, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:created', group.toDTO());
      return reply.code(201).send(group.toDTO());
    });

    app.patch<{ Params: { id: string }; Body: UpdateTicketGroupRequest }>('/api/epics/:id', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      const diff = group.update(request.body);
      await container.ticketGroupStore.saveTicketGroup(group);
      emit({ type: 'ticketGroup.updated', groupId: group.id, changes: { ...request.body }, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:updated', group.toDTO());
      // `changed` lets a caller tell a real write from a no-op (see tickets.routes).
      return { ...group.toDTO(), changed: Object.keys(diff) };
    });

    app.post<{ Params: { id: string } }>('/api/epics/:id/archive', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      group.archive();
      await container.ticketGroupStore.saveTicketGroup(group);
      emit({ type: 'ticketGroup.updated', groupId: group.id, changes: { groupStatus: 'archived' as const }, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:updated', group.toDTO());
      return group.toDTO();
    });

    app.post<{ Params: { id: string } }>('/api/epics/:id/unarchive', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      group.unarchive();
      await container.ticketGroupStore.saveTicketGroup(group);
      emit({ type: 'ticketGroup.updated', groupId: group.id, changes: { groupStatus: 'active' as const }, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:updated', group.toDTO());
      return group.toDTO();
    });

    app.delete<{ Params: { id: string } }>('/api/epics/:id', async (request, reply) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      await container.ticketGroupStore.removeTicketGroup(group.id);
      emit({ type: 'ticketGroup.deleted', groupId: group.id, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:deleted', { id: group.id });
      return reply.code(204).send();
    });

    // ── Board Associations (Epic ↔ Board) ──

    app.get<{ Params: { id: string } }>('/api/epics/:id/boards', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      return group.boardIds;
    });

    app.post<{ Params: { id: string; boardId: string } }>('/api/epics/:id/boards/:boardId', async (request, reply) => {
      const { id: groupId, boardId } = request.params;
      const group = await container.ticketGroupStore.getTicketGroupById(groupId);
      if (!group) throw new TicketGroupNotFoundError(groupId);
      if (!group.hasBoard(boardId)) {
        group.addBoard(boardId);
        await container.ticketGroupStore.addBoardToGroup(groupId, boardId);
        emit({ type: 'ticketGroup.boardAdded', groupId, boardId, occurredAt: new Date() });
        container.ticketBroadcast('ticketGroup:boardAdded', { groupId, boardId });
      }
      return reply.code(201).send({ groupId, boardId });
    });

    app.delete<{ Params: { id: string; boardId: string } }>('/api/epics/:id/boards/:boardId', async (request, reply) => {
      const { id: groupId, boardId } = request.params;
      const group = await container.ticketGroupStore.getTicketGroupById(groupId);
      if (!group) throw new TicketGroupNotFoundError(groupId);

      if (group.boardIds.length <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last board from an epic' });
      }

      // Guard: check if any tickets from this board are in the epic
      const memberships = await container.ticketGroupStore.getMembershipsByGroup(groupId);
      const ticketsFromBoard = await Promise.all(
        memberships.map(async (m) => {
          const t = await container.ticketStore.getTicketById(m.ticketId);
          return t && t.boardId === boardId ? t : null;
        }),
      );
      const blocking = ticketsFromBoard.filter(Boolean);
      if (blocking.length > 0) {
        return reply.code(409).send({
          error: `Cannot remove board: ${blocking.length} ticket(s) from this board are still in the epic. Remove them first.`,
        });
      }

      group.removeBoard(boardId);
      await container.ticketGroupStore.removeBoardFromGroup(groupId, boardId);
      emit({ type: 'ticketGroup.boardRemoved', groupId, boardId, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:boardRemoved', { groupId, boardId });
      return reply.code(204).send();
    });

    // ── Memberships (Ticket ↔ Epic) ──

    // Bulk endpoint: returns all (ticketId, groupId) pairs, optionally scoped to a board.
    // Used by the CLI to enrich ticket listings with epic info without N+1 calls.
    app.get('/api/epics/memberships', async (request) => {
      const { boardId } = request.query as { boardId?: string };
      const groups = boardId
        ? await container.ticketGroupStore.getTicketGroupsByBoard(boardId)
        : await container.ticketGroupStore.getAllTicketGroups();
      const lists = await Promise.all(
        groups.map(async (g) => {
          const memberships = await container.ticketGroupStore.getMembershipsByGroup(g.id);
          return memberships.map((m) => ({ ticketId: m.ticketId, groupId: g.id }));
        }),
      );
      return lists.flat();
    });

    app.get<{ Params: { id: string } }>('/api/epics/:id/tickets', async (request) => {
      const group = await container.ticketGroupStore.getTicketGroupById(request.params.id);
      if (!group) throw new TicketGroupNotFoundError(request.params.id);
      const memberships = await container.ticketGroupStore.getMembershipsByGroup(request.params.id);
      const tickets = await Promise.all(
        memberships.map((m) => container.ticketStore.getTicketById(m.ticketId)),
      );
      return tickets.filter(Boolean).map((t) => t!.toDTO());
    });

    app.post<{ Params: { id: string; ticketId: string } }>('/api/epics/:id/tickets/:ticketId', async (request, reply) => {
      const { id: groupId, ticketId } = request.params;
      await container.ticketGroupStore.addMembership(ticketId, groupId);
      emit({ type: 'ticketGroup.memberAdded', groupId, ticketId, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:memberAdded', { groupId, ticketId });

      // Auto-associate the ticket's board with the epic if not already linked
      const ticket = await container.ticketStore.getTicketById(ticketId);
      if (ticket) {
        const group = await container.ticketGroupStore.getTicketGroupById(groupId);
        if (group && !group.hasBoard(ticket.boardId)) {
          group.addBoard(ticket.boardId);
          await container.ticketGroupStore.addBoardToGroup(groupId, ticket.boardId);
          emit({ type: 'ticketGroup.boardAdded', groupId, boardId: ticket.boardId, occurredAt: new Date() });
          container.ticketBroadcast('ticketGroup:boardAdded', { groupId, boardId: ticket.boardId });
        }
      }

      return reply.code(201).send({ ticketId, groupId });
    });

    app.delete<{ Params: { id: string; ticketId: string } }>('/api/epics/:id/tickets/:ticketId', async (request, reply) => {
      const { id: groupId, ticketId } = request.params;
      await container.ticketGroupStore.removeMembership(ticketId, groupId);
      emit({ type: 'ticketGroup.memberRemoved', groupId, ticketId, occurredAt: new Date() });
      container.ticketBroadcast('ticketGroup:memberRemoved', { groupId, ticketId });
      return reply.code(204).send();
    });

    // ── Get groups for a ticket ──

    app.get<{ Params: { ticketId: string } }>('/api/tickets/:ticketId/epics', async (request) => {
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
      if (ticketId === childId) {
        return reply.code(400).send({ error: 'A ticket cannot be its own child' });
      }
      if (await hasCycle(container, childId, ticketId)) {
        return reply.code(400).send({ error: 'This relationship would create a cycle' });
      }
      await container.ticketGroupStore.addRelationship(ticketId, childId);
      emit({ type: 'ticketRelationship.created', parentId: ticketId, childId, occurredAt: new Date() });
      container.ticketBroadcast('ticketRelationship:created', { parentId: ticketId, childId });
      return reply.code(201).send({ parentId: ticketId, childId });
    });

    app.delete<{ Params: { ticketId: string; childId: string } }>('/api/tickets/:ticketId/children/:childId', async (request, reply) => {
      const { ticketId, childId } = request.params;
      await container.ticketGroupStore.removeRelationship(ticketId, childId);
      emit({ type: 'ticketRelationship.deleted', parentId: ticketId, childId, occurredAt: new Date() });
      container.ticketBroadcast('ticketRelationship:deleted', { parentId: ticketId, childId });
      return reply.code(204).send();
    });
  };
}

async function hasCycle(container: Container, from: string, to: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = await container.ticketGroupStore.getChildRelationships(current);
    for (const c of children) queue.push(c.childId);
  }
  return false;
}
