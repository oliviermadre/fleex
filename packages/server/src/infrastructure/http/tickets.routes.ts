import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TicketStatus, BoardWithCounts, CreateTicketRequest, UpdateTicketRequest, CreateBoardRequest, UpdateBoardRequest } from '@fleex/shared';
import { TICKET_STATUSES } from '@fleex/shared';
import { BoardEntity } from '../../domain/entities/board.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { BoardNotFoundError, TicketNotFoundError, LastBoardError, MentionNotFoundError } from '../../domain/errors.js';
import type { MentionStatus } from '@fleex/shared';
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
      const displayId = await container.ticketStore.getNextDisplayId(boardId);
      const ticketLinks = (links ?? []).map((l) => ({
        ...l,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      }));

      const ticket = TicketEntity.create({
        id: ticketId,
        boardId,
        displayId,
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

    // ── Mention management (web) ──

    app.patch<{
      Params: { id: string };
      Body: { status: MentionStatus };
    }>('/api/mentions/:id/status', async (request) => {
      const mention = await container.mentionStore.getById(request.params.id);
      if (!mention) throw new MentionNotFoundError(request.params.id);

      mention.status = request.body.status;
      if (request.body.status === 'resolved' && !mention.resolvedAt) {
        mention.resolvedAt = new Date();
      } else if (request.body.status !== 'resolved') {
        mention.resolvedAt = null;
      }
      await container.mentionStore.save(mention);

      const dto = mention.toDTO();
      container.ticketBroadcast('mention:updated', dto);
      return dto;
    });

    app.delete<{
      Params: { id: string };
    }>('/api/mentions/:id', async (request, reply) => {
      const mention = await container.mentionStore.getById(request.params.id);
      if (!mention) throw new MentionNotFoundError(request.params.id);

      await container.mentionStore.remove(mention.id);
      container.ticketBroadcast('mention:deleted', { id: mention.id, ticketId: mention.ticketId, commentId: mention.commentId });
      return reply.code(204).send();
    });

    app.delete<{
      Params: { id: string };
    }>('/api/mentions/:id/from-comment', async (request, reply) => {
      const mention = await container.mentionStore.getById(request.params.id);
      if (!mention) throw new MentionNotFoundError(request.params.id);

      // Update comment body: wrap the mention text in ~~strikethrough~~
      const comment = await container.commentStore.getById(mention.commentId);
      if (comment) {
        const mentionText = mention.targetType === 'human'
          ? `@${mention.targetAgent}`
          : `@agent:${mention.targetAgent}`;
        const newBody = comment.body.replace(mentionText, `~~${mentionText}~~`);
        if (newBody !== comment.body) {
          comment.body = newBody;
          comment.updatedAt = new Date();
          await container.commentStore.save(comment);
          container.ticketBroadcast('comment:updated', comment.toDTO());
        }
      }

      await container.mentionStore.remove(mention.id);
      container.ticketBroadcast('mention:deleted', { id: mention.id, ticketId: mention.ticketId, commentId: mention.commentId });
      return reply.code(204).send();
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

        const { humanDisplayName, humanMentionName } = container.config.get();
        const { comment, createdMentions } = await container.postComment.execute({
          ticketId: request.params.id,
          authorType: 'user',
          authorName: humanDisplayName || humanMentionName || 'user',
          body: request.body.body,
          visibility: 'public',
          humanMentionNames: humanMentionName ? [humanMentionName] : [],
        });

        const dto = comment.toDTO();
        container.ticketBroadcast('comment:created', dto);

        for (const mention of createdMentions) {
          container.ticketBroadcast('mention:created', mention.toDTO());
        }

        // Wake up agents waiting for info on this ticket
        container.wakeWaitingAgents.execute(request.params.id).catch(() => {});

        // Handle auto-review workflow for human mentions
        for (const mention of createdMentions) {
          if (mention.targetType === 'human') {
            container.autoReviewWorkflow.handleHumanMention({
              ticketId: request.params.id,
              mentionedHuman: mention.targetAgent,
            }).catch((error) => {
              container.logger.error('Failed to handle human mention for auto-review', {
                ticketId: request.params.id,
                mentionedHuman: mention.targetAgent,
                error: String(error),
              });
            });
          }
        }

        // Handle agent mentions in reviewing status (back to doing)
        for (const mention of createdMentions) {
          if (mention.targetType === 'agent') {
            container.autoReviewWorkflow.handleAgentMentionInReview({
              ticketId: request.params.id,
              mentionedAgent: mention.targetAgent,
            }).catch((error) => {
              container.logger.error('Failed to handle agent mention in review', {
                ticketId: request.params.id,
                mentionedAgent: mention.targetAgent,
                error: String(error),
              });
            });
          }
        }

        // Auto-trigger mentioned agents
        for (const mention of createdMentions) {
          if (mention.targetType === 'agent') {
            const persona = await container.personaStore.getByName(mention.targetAgent);
            if (persona) container.executeAgent.execute(persona.id).catch(() => {});
          }
        }

        return reply.code(201).send(dto);
      },
    );
  };
}
