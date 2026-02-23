import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketNotFoundError, WorktreeError } from '../../domain/errors.js';
import type { Container } from '../container.js';

function sanitizeBranchForPath(branch: string): string {
  return branch.toLowerCase()
    .replace(/[/_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function buildBranchName(title: string, ticketId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = ticketId.slice(0, 6);
  return `ticket/${short}-${slug}`;
}

export function agentWorktreesRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // Get worktree linked to a ticket
    app.get<{ Params: { id: string } }>('/tickets/:id/worktree', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const worktreeLink = ticket.links.find((l) => l.type === 'worktree');
      if (!worktreeLink) {
        return { linked: false, worktree: null };
      }

      return {
        linked: true,
        worktree: {
          id: worktreeLink.id,
          path: worktreeLink.ref,
          branch: worktreeLink.label,
          createdAt: worktreeLink.createdAt,
        },
      };
    });

    // Create worktree and link to ticket (idempotent)
    app.post<{ Params: { id: string }; Body: { baseBranch?: string } }>(
      '/tickets/:id/worktree',
      async (request, reply) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        // Idempotent: return existing worktree link if present
        const existingLink = ticket.links.find((l) => l.type === 'worktree');
        if (existingLink) {
          return reply.code(200).send({
            created: false,
            worktree: {
              id: existingLink.id,
              path: existingLink.ref,
              branch: existingLink.label,
              createdAt: existingLink.createdAt,
            },
          });
        }

        // Resolve repo: ticket repository link first, then board fallback
        let repoOrg: string | undefined;
        let repoName: string | undefined;

        const repoLink = ticket.links.find((l) => l.type === 'repository');
        if (repoLink?.ref?.includes('/')) {
          const [org, name] = repoLink.ref.split('/');
          repoOrg = org;
          repoName = name;
        }

        if (!repoOrg || !repoName) {
          const board = await container.ticketStore.getBoardById(ticket.boardId);
          if (board?.repositoryOrg && board.repositoryName) {
            repoOrg = board.repositoryOrg;
            repoName = board.repositoryName;
          }
        }

        if (!repoOrg || !repoName) {
          throw new WorktreeError('No repository found on ticket or board');
        }

        const repoPath = join(container.config.get().basePath, repoOrg, repoName);
        const branchName = buildBranchName(ticket.title, ticket.id);
        const sanitized = sanitizeBranchForPath(branchName);
        const dirName = `${repoName}.${sanitized}`;
        const wtPath = join(repoPath, '..', dirName);

        const baseBranch = request.body?.baseBranch;
        await container.createWorktree.execute(repoPath, wtPath, {
          branch: branchName,
          createNewBranch: true,
          ...(baseBranch ? { baseBranch } : {}),
        });

        const linkId = randomUUID();
        ticket.addLink('worktree', wtPath, branchName, null, linkId);
        await container.ticketStore.saveTicket(ticket);

        await container.ticketStore.saveActivity(TicketActivityEntity.create({
          id: randomUUID(),
          ticketId: ticket.id,
          action: 'linked',
          changes: { worktree: { from: null, to: wtPath } },
          source: 'api',
          actorType: 'agent',
          actorName: request.agent?.name,
        }));

        const dto = ticket.toDTO();
        container.ticketBroadcast('ticket:updated', dto);

        return reply.code(201).send({
          created: true,
          worktree: {
            id: linkId,
            path: wtPath,
            branch: branchName,
            createdAt: ticket.links.find((l) => l.id === linkId)?.createdAt,
          },
        });
      },
    );
  };
}
