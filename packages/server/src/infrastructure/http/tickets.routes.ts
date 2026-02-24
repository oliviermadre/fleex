import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TicketStatus, BoardWithCounts, CreateTicketRequest, UpdateTicketRequest, CreateBoardRequest, UpdateBoardRequest } from '@asm/shared';
import { TICKET_STATUSES } from '@asm/shared';
import { BoardEntity } from '../../domain/entities/board.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { BoardNotFoundError, TicketNotFoundError, LastBoardError } from '../../domain/errors.js';
import type { Container } from '../container.js';

export function ticketRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // ── Boards ──

    app.get('/api/boards', async () => {
      const boards = await container.ticketStore.getAllBoards();
      return Promise.all(boards.map(async (b): Promise<BoardWithCounts> => {
        const tickets = await container.ticketStore.getTicketsByBoard(b.id);
        const ticketCounts = {} as Record<TicketStatus, number>;
        for (const s of TICKET_STATUSES) {
          ticketCounts[s] = tickets.filter((t) => t.status === s).length;
        }
        return { ...b.toDTO(), ticketCounts };
      }));
    });

    app.get<{ Params: { id: string } }>('/api/boards/:id', async (request) => {
      const board = await container.ticketStore.getBoardById(request.params.id);
      if (!board) throw new BoardNotFoundError(request.params.id);
      return board.toDTO();
    });

    app.post<{ Body: CreateBoardRequest }>('/api/boards', async (request, reply) => {
      const board = BoardEntity.create({
        id: randomUUID(),
        name: request.body.name,
        emoji: request.body.emoji,
        repositoryOrg: request.body.repositoryOrg,
        repositoryName: request.body.repositoryName,
      });
      await container.ticketStore.saveBoard(board);
      container.ticketBroadcast('board:updated', board.toDTO());
      return reply.code(201).send(board.toDTO());
    });

    app.patch<{ Params: { id: string }; Body: UpdateBoardRequest }>('/api/boards/:id', async (request) => {
      const board = await container.ticketStore.getBoardById(request.params.id);
      if (!board) throw new BoardNotFoundError(request.params.id);
      board.update(request.body);
      await container.ticketStore.saveBoard(board);
      container.ticketBroadcast('board:updated', board.toDTO());
      return board.toDTO();
    });

    app.delete<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
      const boards = await container.ticketStore.getAllBoards();
      if (boards.length <= 1) throw new LastBoardError();
      await container.ticketStore.removeTicketsByBoard(request.params.id);
      await container.ticketStore.removeBoard(request.params.id);
      container.ticketBroadcast('board:updated', { deleted: request.params.id });
      return reply.code(204).send();
    });

    // ── Tickets ──

    app.get<{ Querystring: { boardId?: string; status?: TicketStatus; tag?: string } }>(
      '/api/tickets',
      async (request) => {
        let tickets: TicketEntity[];
        if (request.query.boardId) {
          if (request.query.status) {
            tickets = await container.ticketStore.getTicketsByStatus(request.query.boardId, request.query.status);
          } else {
            tickets = await container.ticketStore.getTicketsByBoard(request.query.boardId);
          }
        } else {
          tickets = await container.ticketStore.getAllTickets();
        }
        if (request.query.tag) {
          const tag = request.query.tag;
          tickets = tickets.filter((t) => t.tags.includes(tag));
        }
        return tickets.map((t) => t.toDTO());
      },
    );

    app.get<{ Params: { id: string } }>('/api/tickets/:id', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);
      return ticket.toDTO();
    });

    app.post<{ Body: CreateTicketRequest }>('/api/tickets', async (request, reply) => {
      const { boardId, title, description, status, priority, tags, links, dueDate } = request.body;

      const board = await container.ticketStore.getBoardById(boardId);
      if (!board) throw new BoardNotFoundError(boardId);

      // Calculate position (end of column)
      const targetStatus = status ?? 'backlog';
      const existing = await container.ticketStore.getTicketsByStatus(boardId, targetStatus);
      const maxPos = existing.reduce((max, t) => Math.max(max, t.position), -1);

      const ticketId = randomUUID();
      const ticketLinks = (links ?? []).map((l) => ({
        ...l,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      }));

      const ticket = TicketEntity.create({
        id: ticketId,
        boardId,
        title,
        description,
        status: targetStatus,
        priority,
        position: maxPos + 1,
        tags,
        links: ticketLinks,
        dueDate: dueDate ? new Date(dueDate) : null,
      });

      await container.ticketStore.saveTicket(ticket);
      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId,
        action: 'created',
        source: 'web',
      }));

      const dto = ticket.toDTO();
      container.ticketBroadcast('ticket:created', dto);
      return reply.code(201).send(dto);
    });

    app.patch<{ Params: { id: string }; Querystring: { silent?: string }; Body: UpdateTicketRequest }>('/api/tickets/:id', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const { dueDate, ...rest } = request.body;
      const changes: Parameters<TicketEntity['update']>[0] = { ...rest };
      if (dueDate !== undefined) {
        changes.dueDate = dueDate ? new Date(dueDate) : null;
      }

      const diff = ticket.update(changes);
      await container.ticketStore.saveTicket(ticket);

      const silent = request.query.silent === 'true';
      if (!silent && Object.keys(diff).length > 0) {
        await container.ticketStore.saveActivity(TicketActivityEntity.create({
          id: randomUUID(),
          ticketId: ticket.id,
          action: 'updated',
          changes: diff,
          source: 'web',
        }));
      }

      const dto = ticket.toDTO();
      container.ticketBroadcast('ticket:updated', dto);
      return dto;
    });

    app.delete<{ Params: { id: string } }>('/api/tickets/:id', async (request, reply) => {
      await container.ticketStore.removeTicket(request.params.id);
      container.ticketBroadcast('ticket:deleted', { id: request.params.id });
      return reply.code(204).send();
    });

    app.post<{ Params: { id: string }; Body: { status: TicketStatus; position?: number } }>(
      '/api/tickets/:id/move',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const diff = ticket.moveTo(request.body.status);
        if (request.body.position !== undefined) {
          ticket.position = request.body.position;
          ticket.updatedAt = new Date();
        }

        await container.ticketStore.saveTicket(ticket);

        if (Object.keys(diff).length > 0) {
          await container.ticketStore.saveActivity(TicketActivityEntity.create({
            id: randomUUID(),
            ticketId: ticket.id,
            action: 'moved',
            changes: diff,
            source: 'web',
          }));
        }

        const dto = ticket.toDTO();
        container.ticketBroadcast('ticket:moved', dto);
        return dto;
      },
    );

    // Links
    app.post<{ Params: { id: string }; Body: { type: string; ref: string; label: string; url?: string } }>(
      '/api/tickets/:id/links',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const link = ticket.addLink(
          request.body.type as Parameters<TicketEntity['addLink']>[0],
          request.body.ref,
          request.body.label,
          request.body.url ?? null,
          randomUUID(),
        );

        await container.ticketStore.saveTicket(ticket);
        await container.ticketStore.saveActivity(TicketActivityEntity.create({
          id: randomUUID(),
          ticketId: ticket.id,
          action: 'linked',
          changes: { link: { from: null, to: link } },
          source: 'web',
        }));

        container.ticketBroadcast('ticket:updated', ticket.toDTO());
        return link;
      },
    );

    app.delete<{ Params: { id: string; linkId: string } }>(
      '/api/tickets/:id/links/:linkId',
      async (request, reply) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const removed = ticket.removeLink(request.params.linkId);
        if (removed) {
          await container.ticketStore.saveTicket(ticket);
          await container.ticketStore.saveActivity(TicketActivityEntity.create({
            id: randomUUID(),
            ticketId: ticket.id,
            action: 'unlinked',
            changes: { linkId: { from: request.params.linkId, to: null } },
            source: 'web',
          }));
          container.ticketBroadcast('ticket:updated', ticket.toDTO());
        }

        return reply.code(204).send();
      },
    );

    // Activity
    app.get<{ Params: { id: string } }>('/api/tickets/:id/activity', async (request) => {
      return (await container.ticketStore.getActivitiesByTicket(request.params.id)).map((a) => a.toDTO());
    });

    // Workflow: open session from ticket
    app.post<{ Params: { id: string } }>('/api/tickets/:id/open-session', async (request) => {
      const result = await container.createSessionFromTicket.execute(request.params.id);
      return result;
    });

    // Import GitHub issue
    app.post<{ Body: { org: string; name: string; number: number; boardId: string } }>(
      '/api/tickets/import-github-issue',
      async (request, reply) => {
        const { org, name, number: issueNumber, boardId } = request.body;
        const ticket = await container.importGitHubIssue.execute(org, name, issueNumber, boardId);
        const dto = ticket.toDTO();
        container.ticketBroadcast('ticket:created', dto);
        return reply.code(201).send(dto);
      },
    );

    // Sync GitHub metadata
    app.post<{ Params: { id: string } }>(
      '/api/tickets/:id/sync-github',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const issueLink = ticket.links.find((l) => l.type === 'github_issue');
        if (!issueLink) {
          throw new Error('Ticket has no linked GitHub issue');
        }

        // Parse org/name#number from ref
        const match = issueLink.ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        if (!match) {
          throw new Error('Invalid GitHub issue link ref format');
        }

        const org = match[1]!;
        const name = match[2]!;
        const num = match[3]!;
        const detail = await container.githubGraphql.fetchIssueDetail(org, name, parseInt(num, 10));

        ticket.setGithubMetadata({
          state: detail.state,
          author: detail.author,
          assignees: detail.assignees,
          labels: detail.labels,
          milestone: detail.milestone,
          syncedAt: new Date().toISOString(),
        });

        await container.ticketStore.saveTicket(ticket);
        const dto = ticket.toDTO();
        container.ticketBroadcast('ticket:updated', dto);
        return dto;
      },
    );

    // Batch reorder
    app.post<{ Body: { updates: { id: string; status: TicketStatus; position: number }[] } }>(
      '/api/tickets/reorder',
      async (request) => {
        for (const upd of request.body.updates) {
          const ticket = await container.ticketStore.getTicketById(upd.id);
          if (!ticket) continue;
          ticket.moveTo(upd.status);
          ticket.position = upd.position;
          ticket.updatedAt = new Date();
          await container.ticketStore.saveTicket(ticket);
        }
        return { ok: true };
      },
    );

    // ── Mentions (web) ──

    app.get<{ Params: { id: string } }>('/api/tickets/:id/mentions', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const mentions = await container.mentionStore.getByTicket(request.params.id);
      return mentions.map((m) => m.toDTO());
    });

    // ── Deliverables (web) ──

    app.get<{ Params: { id: string } }>('/api/tickets/:id/deliverables', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const deliverables = await container.deliverableStore.getByTicket(request.params.id);
      return deliverables.map((d) => d.toDTO());
    });

    // ── Comments (web) ──

    app.get<{ Params: { id: string } }>('/api/tickets/:id/comments', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const comments = (await container.commentStore.getByTicket(request.params.id))
        .filter((c) => c.isVisibleTo('user'));

      return comments.map((c) => c.toDTO());
    });

    app.post<{ Params: { id: string }; Body: { body: string } }>(
      '/api/tickets/:id/comments',
      async (request, reply) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const { comment, createdMentions } = await container.postComment.execute({
          ticketId: request.params.id,
          authorType: 'user',
          authorName: 'user',
          body: request.body.body,
          visibility: 'public',
        });

        const dto = comment.toDTO();
        container.ticketBroadcast('comment:created', dto);

        for (const mention of createdMentions) {
          container.ticketBroadcast('mention:created', mention.toDTO());
        }

        return reply.code(201).send(dto);
      },
    );
  };
}
