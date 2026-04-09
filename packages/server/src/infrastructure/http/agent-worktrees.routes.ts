import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketNotFoundError, WorktreeError } from '../../domain/errors.js';
import { buildTicketBranchName, buildTicketWorkspaceId } from '../../domain/services/branch-utils.js';
import type { Container } from '../container.js';

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
          throw new WorktreeError('No repository found on ticket');
        }

        const branchName = buildTicketBranchName(ticket.title, ticket.id);
        const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
        const wtPath = container.resolver.workspaceRepoPath(workspaceId, repoName);

        const baseBranch = request.body?.baseBranch;
        await container.createWorktree.execute(repoOrg, repoName, wtPath, {
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
