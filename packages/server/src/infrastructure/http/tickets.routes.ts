import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TicketStatus, TicketType, BoardWithCounts, CreateTicketRequest, UpdateTicketRequest, CreateBoardRequest, UpdateBoardRequest, DeliverableType, DeliverableStatus } from '@fleex/shared';
import { TICKET_STATUSES } from '@fleex/shared';
import { BoardEntity } from '../../domain/entities/board.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';
import { buildTicketBranchName, buildTicketWorkspaceId, buildWorktreeDirName } from '../../domain/services/branch-utils.js';
import { deriveTicketUpdateEvents } from '../../domain/services/ticket-audit-events.js';
import { deriveTicketAgentActivity, deriveActivitySince } from '../../domain/services/ticket-agent-activity.js';
import { BoardNotFoundError, TicketNotFoundError, LastBoardError, MentionNotFoundError, CommentNotFoundError, DeliverableNotFoundError } from '../../domain/errors.js';
import type { MentionExecutionMode, MentionStatus, UpdateTicketExecutionConfigRequest } from '@fleex/shared';
import type { Container } from '../container.js';

export function ticketRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  // ── Epic enrichment helpers (used by /api/tickets and /api/tickets/:id) ──

  type EpicRef = {
    id: string;
    name: string;
    emoji: string;
    color: string;
    timeframe: string;
    groupStatus: string;
  };

  const toEpicRef = (g: { id: string; name: string; emoji: string; color: string; timeframe: string; groupStatus: string }): EpicRef => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    color: g.color,
    timeframe: g.timeframe,
    groupStatus: g.groupStatus,
  });

  // Build a Map<ticketId, EpicRef[]> for a set of tickets.
  // When `boardId` is set, only groups linked to that board are scanned (fast path).
  // Otherwise all groups are scanned (needed when listing across boards).
  async function loadEpicsByTicketIds(ticketIds: string[], opts: { boardId?: string } = {}): Promise<Map<string, EpicRef[]>> {
    const map = new Map<string, EpicRef[]>();
    if (ticketIds.length === 0) return map;
    const groups = opts.boardId
      ? await container.ticketGroupStore.getTicketGroupsByBoard(opts.boardId)
      : await container.ticketGroupStore.getAllTicketGroups();
    if (groups.length === 0) return map;
    const wanted = new Set(ticketIds);
    const memberships = await Promise.all(
      groups.map((g) => container.ticketGroupStore.getMembershipsByGroup(g.id)),
    );
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupMemberships = memberships[i];
      if (!group || !groupMemberships) continue;
      const ref = toEpicRef(group);
      for (const m of groupMemberships) {
        if (!wanted.has(m.ticketId)) continue;
        const arr = map.get(m.ticketId);
        if (arr) arr.push(ref); else map.set(m.ticketId, [ref]);
      }
    }
    return map;
  }

  async function loadEpicsForTicket(ticketId: string): Promise<EpicRef[]> {
    const memberships = await container.ticketGroupStore.getMembershipsByTicket(ticketId);
    if (memberships.length === 0) return [];
    const groups = await Promise.all(
      memberships.map((m) => container.ticketGroupStore.getTicketGroupById(m.groupId)),
    );
    return groups
      .filter((g): g is NonNullable<typeof g> => g != null)
      .map(toEpicRef);
  }

  return async function (app: FastifyInstance) {

    // ── Boards ──

    app.get('/api/boards', async () => {
      const boards = await container.ticketStore.getAllBoards();
      return Promise.all(boards.map(async (b): Promise<BoardWithCounts> => {
        const tickets = await container.ticketStore.getTicketsByBoard(b.id);
        const ticketCounts = {} as Record<TicketStatus, number>;
        for (const s of TICKET_STATUSES as readonly TicketStatus[]) {
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
      });
      await container.ticketStore.saveBoard(board);
      emit({ type: 'board.updated', boardId: board.id, occurredAt: new Date() });
      return reply.code(201).send(board.toDTO());
    });

    app.patch<{ Params: { id: string }; Body: UpdateBoardRequest }>('/api/boards/:id', async (request) => {
      const board = await container.ticketStore.getBoardById(request.params.id);
      if (!board) throw new BoardNotFoundError(request.params.id);
      board.update(request.body);
      await container.ticketStore.saveBoard(board);
      emit({ type: 'board.updated', boardId: board.id, occurredAt: new Date() });
      return board.toDTO();
    });

    app.delete<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
      const boards = await container.ticketStore.getAllBoards();
      if (boards.length <= 1) throw new LastBoardError();
      await container.ticketStore.removeTicketsByBoard(request.params.id);
      await container.ticketStore.removeBoard(request.params.id);
      emit({ type: 'board.deleted', boardId: request.params.id, occurredAt: new Date() });
      return reply.code(204).send();
    });

    // ── Tickets ──

    app.get<{ Querystring: { boardId?: string; status?: TicketStatus; tag?: string; epicId?: string } }>(
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
        if (request.query.epicId) {
          const memberships = await container.ticketGroupStore.getMembershipsByGroup(request.query.epicId);
          const epicTicketIds = new Set(memberships.map((m) => m.ticketId));
          tickets = tickets.filter((t) => epicTicketIds.has(t.id));
        }
        const epicsByTicket = await loadEpicsByTicketIds(
          tickets.map((t) => t.id),
          { boardId: request.query.boardId },
        );
        return tickets.map((t) => ({ ...t.toDTO(), epics: epicsByTicket.get(t.id) ?? [] }));
      },
    );

    app.get<{ Querystring: { boardId?: string; limit?: string; offset?: string } }>(
      '/api/tickets/archived',
      async (request) => {
        const boardId = request.query.boardId || undefined;
        const limit = parseInt(request.query.limit ?? '50', 10);
        const offset = parseInt(request.query.offset ?? '0', 10);
        const [tickets, total] = await Promise.all([
          container.ticketStore.getArchivedTickets(boardId, limit, offset),
          container.ticketStore.countArchivedTickets(boardId),
        ]);
        return { tickets: tickets.map((t) => t.toDTO()), total };
      },
    );

    app.get<{ Params: { id: string } }>('/api/tickets/:id', async (request) => {
      // Accept UUID or displayId (#161, 161). DisplayIds are globally unique.
      const raw = request.params.id.replace(/^#/, '');
      let ticket: TicketEntity | null;
      if (/^\d+$/.test(raw)) {
        // getTicketByDisplayId spans archived tickets, so this resolves an
        // archived ticket by its display id too (needed by `ticket unarchive`).
        ticket = await container.ticketStore.getTicketByDisplayId(Number.parseInt(raw, 10));
      } else {
        ticket = await container.ticketStore.getTicketById(raw);
      }
      if (!ticket) throw new TicketNotFoundError(request.params.id);
      const epics = await loadEpicsForTicket(ticket.id);
      return { ...ticket.toDTO(), epics };
    });

    app.post<{ Body: CreateTicketRequest }>('/api/tickets', async (request, reply) => {
      const { boardId, title, description, status, priority, type, tags, links, dueDate } = request.body;

      const board = await container.ticketStore.getBoardById(boardId);
      if (!board) throw new BoardNotFoundError(boardId);

      // Calculate position (top of column)
      const targetStatus = status ?? 'backlog';
      const existing = await container.ticketStore.getTicketsByStatus(boardId, targetStatus);
      const minPos = existing.length > 0
        ? existing.reduce((min, t) => Math.min(min, t.position), Infinity)
        : 1;

      const ticketId = randomUUID();
      const ticketLinks = (links ?? []).map((l) => ({
        ...l,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      }));

      const ticket = TicketEntity.create({
        id: ticketId,
        boardId,
        displayId: 0, // assigned by createTicket() below
        title,
        description,
        status: targetStatus,
        priority,
        type,
        position: minPos - 1,
        tags,
        links: ticketLinks,
        dueDate: dueDate ? new Date(dueDate) : null,
      });

      await container.ticketStore.createTicket(ticket);
      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId,
        action: 'created',
        source: 'web',
      }));

      emit({ type: 'ticket.created', ticketId, boardId, occurredAt: new Date() });
      return reply.code(201).send(ticket.toDTO());
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

      // Emit semantic events for favorite/blocked/tags so the audit trail records
      // *what* the user did, not an opaque `ticket.updated`. Remaining fields
      // (title, priority, due date…) still go through the generic `ticket.updated`.
      for (const event of deriveTicketUpdateEvents(ticket.id, diff, new Date())) {
        emit(event);
      }
      return ticket.toDTO();
    });

    // PATCH /api/tickets/:id/execution-config — conversation-scoped execution
    // settings (mode, model/effort/fast overrides). Persists immediately and
    // broadcasts ticket:updated. Sends NO comment and creates NO mention.
    app.patch<{ Params: { id: string }; Body: UpdateTicketExecutionConfigRequest }>(
      '/api/tickets/:id/execution-config',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const diff = ticket.updateExecutionConfig(request.body);
        if (Object.keys(diff).length > 0) {
          await container.ticketStore.saveTicket(ticket);
          emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
        }

        return ticket.toDTO();
      },
    );

    app.delete<{ Params: { id: string } }>('/api/tickets/:id', async (request, reply) => {
      const ticketId = request.params.id;
      const ticket = await container.ticketStore.getTicketById(ticketId);

      // Cleanup uploaded files referenced in ticket description + comments
      try {
        const comments = await container.commentStore.getByTicket(ticketId);
        const allText = [ticket?.description ?? '', ...comments.map((c) => c.body)].join('\n');
        const fileIds = extractFileIds(allText);
        await Promise.all(fileIds.map(async (fid) => {
          await container.fileStore.remove(fid).catch(() => {});
          await container.fileMetaStore.remove(fid).catch(() => {});
        }));
      } catch {
        // Best-effort cleanup — don't block ticket deletion
      }

      // Cleanup workspace: remove git worktrees, kill sessions, delete workspace folder
      if (ticket) {
        const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
        const workspaceBase = container.resolver.workspacePath(workspaceId);

        try {
          // Kill sessions whose cwd is inside the workspace
          const allSessions = await container.sessionStore.getAll();
          const workspaceSessions = allSessions.filter((s) => s.cwd.startsWith(workspaceBase));
          await Promise.all(workspaceSessions.map(async (s) => {
            await container.killSession.execute(s.id).catch(() => {});
          }));

          // Remove git worktrees for each repo linked to this ticket
          for (const link of ticket.links) {
            if (link.type === 'repository') {
              const slashIdx = link.ref.indexOf('/');
              if (slashIdx > 0) {
                const org = link.ref.substring(0, slashIdx);
                const name = link.ref.substring(slashIdx + 1);
                const wtPath = container.resolver.workspaceRepoPath(workspaceId, name);
                if (existsSync(wtPath)) {
                  const barePath = container.resolver.barePath(org, name);
                  // Resolve the branch before removal so the audit event is informative.
                  let branch: string | undefined;
                  try {
                    const worktrees = await container.git.listWorktrees(barePath);
                    branch = worktrees.find((wt) => wt.path === wtPath)?.branch;
                  } catch {
                    // Best-effort — don't block deletion on a failed branch lookup.
                  }
                  try {
                    await container.git.removeWorktree(barePath, wtPath);
                    emit({
                      type: 'worktree.deleted',
                      repoPath: barePath,
                      worktreePath: wtPath,
                      ...(branch ? { branch } : {}),
                      occurredAt: new Date(),
                    });
                  } catch (err) {
                    container.logger.warn('Failed to remove worktree on ticket delete', {
                      wtPath, ticketId, error: err instanceof Error ? err.message : String(err),
                    });
                  }
                }
              }
            }
          }

          // Remove the workspace folder
          if (existsSync(workspaceBase)) {
            rmSync(workspaceBase, { recursive: true, force: true });
            container.logger.info('Workspace cleaned up on ticket delete', { workspaceBase, ticketId });
          }
        } catch (err) {
          container.logger.warn('Failed to cleanup workspace on ticket delete', {
            ticketId, error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await container.ticketStore.removeTicket(ticketId);
      emit({ type: 'ticket.deleted', ticketId, occurredAt: new Date() });
      return reply.code(204).send();
    });

    // ── Archive / Unarchive ──

    app.post<{ Params: { id: string } }>('/api/tickets/:id/archive', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const diff = ticket.archive();
      await container.ticketStore.saveTicket(ticket);

      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'archived',
        changes: diff,
        source: 'web',
      }));

      emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
      return ticket.toDTO();
    });

    app.post<{ Params: { id: string } }>('/api/tickets/:id/unarchive', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const diff = ticket.unarchive();
      await container.ticketStore.saveTicket(ticket);

      await container.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'unarchived',
        changes: diff,
        source: 'web',
      }));

      emit({ type: 'ticket.updated', ticketId: ticket.id, changes: diff, occurredAt: new Date() });
      return ticket.toDTO();
    });

    app.post<{ Params: { id: string }; Body: { status: TicketStatus; position?: number } }>(
      '/api/tickets/:id/move',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const fromStatus = ticket.status;
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

        emit({ type: 'ticket.moved', ticketId: ticket.id, fromStatus, toStatus: request.body.status, occurredAt: new Date() });
        return ticket.toDTO();
      },
    );

    // Links
    app.post<{ Params: { id: string }; Body: { type: string; ref: string; label: string; url?: string } }>(
      '/api/tickets/:id/links',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        let ref = request.body.ref;

        // When linking a worktree to a ticket, move it into the ticket workspace
        if (request.body.type === 'worktree' && ref.includes(':') && !ref.startsWith('/')) {
          const colonIdx = ref.indexOf(':');
          const repoKey = ref.substring(0, colonIdx);
          const branch = ref.substring(colonIdx + 1);
          const slashIdx = repoKey.indexOf('/');
          if (slashIdx > 0) {
            const org = repoKey.substring(0, slashIdx);
            const name = repoKey.substring(slashIdx + 1);
            const barePath = container.resolver.barePath(org, name);
            const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
            const targetPath = container.resolver.workspaceRepoPath(workspaceId, name);

            try {
              // Find the worktree's current path
              const worktrees = await container.git.listWorktrees(barePath);
              const match = worktrees.find((wt) => wt.branch === branch);
              if (match && match.path !== targetPath) {
                // Move worktree to ticket workspace
                await container.git.moveWorktree(barePath, match.path, targetPath);
                container.logger.info('Worktree moved to ticket workspace', {
                  from: match.path, to: targetPath, ticketId: ticket.id,
                });
              }
              // Update ref to absolute workspace path
              ref = targetPath;
            } catch (err) {
              container.logger.warn('Failed to move worktree to workspace, keeping original ref', {
                ticketId: ticket.id, ref, error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        const link = ticket.addLink(
          request.body.type as Parameters<TicketEntity['addLink']>[0],
          ref,
          request.body.label,
          request.body.url ?? null,
          randomUUID(),
        );

        // When adding a repository link, create worktree if ticket already has a workspace
        if (request.body.type === 'repository' && ref.includes('/')) {
          const slashIdx = ref.indexOf('/');
          const org = ref.substring(0, slashIdx);
          const name = ref.substring(slashIdx + 1);
          const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
          const workspaceRoot = container.resolver.workspacePath(workspaceId);
          const manifestPath = join(workspaceRoot, '.fleex.json');

          if (existsSync(manifestPath)) {
            const wtPath = container.resolver.workspaceRepoPath(workspaceId, name);
            if (!existsSync(wtPath)) {
              // Check if this repo has a linked PR — if so, use the PR's branch
              let branchName: string | null = null;
              let createNewBranch = true;
              const prLink = ticket.links.find((l) => l.type === 'github_pr' && l.ref.startsWith(`${org}/${name}#`));
              if (prLink) {
                const prNumber = parseInt(prLink.ref.split('#')[1]!, 10);
                if (prNumber) {
                  // Try cache first, then fetch
                  const cached = container.repositoryCache.get<import('@fleex/shared').PullRequest[]>(`pulls:${org}/${name}`);
                  const pr = cached?.data?.find((p) => p.number === prNumber);
                  if (pr) {
                    branchName = pr.headRefName;
                    createNewBranch = false;
                  } else {
                    try {
                      const result = await container.githubGraphql.fetchRepoBatch([{ org, name }]);
                      const repoData = result.get(`${org}/${name}`);
                      const fetchedPR = repoData?.pulls?.find((p: { number: number; headRefName: string }) => p.number === prNumber);
                      if (fetchedPR) {
                        branchName = fetchedPR.headRefName;
                        createNewBranch = false;
                      }
                    } catch { /* ignore — fall through to ticket branch */ }
                  }
                }
              }
              if (!branchName) {
                branchName = buildTicketBranchName(ticket.title, ticket.id);
              }

              try {
                await container.createWorktree.execute(org, name, wtPath, { branch: branchName, createNewBranch });
                ticket.addLink('worktree', wtPath, branchName, null, randomUUID());
                container.logger.info('Worktree created for added repo', { ticketId: ticket.id, repo: ref, branch: branchName, wtPath });
              } catch (err) {
                container.logger.warn('Failed to create worktree for added repo', {
                  ticketId: ticket.id, repo: ref, error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        }

        await container.ticketStore.saveTicket(ticket);
        await container.ticketStore.saveActivity(TicketActivityEntity.create({
          id: randomUUID(),
          ticketId: ticket.id,
          action: 'linked',
          changes: { link: { from: null, to: link } },
          source: 'web',
        }));

        emit({
          type: 'ticket.linkAdded',
          ticketId: ticket.id,
          linkType: link.type,
          ref: link.ref,
          label: link.label,
          occurredAt: new Date(),
        });
        return link;
      },
    );

    app.delete<{ Params: { id: string; linkId: string } }>(
      '/api/tickets/:id/links/:linkId',
      async (request, reply) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        // Before removing, check if it's a worktree link in a workspace — move it back
        const link = ticket.links.find((l) => l.id === request.params.linkId);
        if (link?.type === 'worktree') {
          const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
          const workspaceBase = container.resolver.workspacePath(workspaceId);

          try {
            // Resolve org/name/branch and current path from the link ref
            let wtPath: string | null = null;
            let org: string | null = null;
            let name: string | null = null;
            let branch: string | null = null;

            if (link.ref.includes(':') && !link.ref.startsWith('/')) {
              // UI format: "org/name:branch"
              const colonIdx = link.ref.indexOf(':');
              const repoKey = link.ref.substring(0, colonIdx);
              branch = link.ref.substring(colonIdx + 1);
              const si = repoKey.indexOf('/');
              if (si > 0) {
                org = repoKey.substring(0, si);
                name = repoKey.substring(si + 1);
              }
              if (org && name) {
                const barePath = container.resolver.barePath(org, name);
                const worktrees = await container.git.listWorktrees(barePath);
                const match = worktrees.find((wt) => wt.branch === branch);
                if (match) wtPath = match.path;
              }
            } else if (link.ref.startsWith('/')) {
              // Absolute path — the worktree IS at this path
              wtPath = link.ref;
              branch = link.label;
              // Derive org/name: try repository link, then board config, then scan bare clones
              const repoLink = ticket.links.find((l) => l.type === 'repository');
              if (repoLink?.ref?.includes('/')) {
                const si = repoLink.ref.indexOf('/');
                org = repoLink.ref.substring(0, si);
                name = repoLink.ref.substring(si + 1);
              }
              if (!org || !name) {
                // Fallback: find which bare clone owns this worktree
                const bareClones = await container.bareCloneManager.listBareClones();
                for (const bc of bareClones) {
                  const barePath = container.resolver.barePath(bc.org, bc.name);
                  try {
                    const worktrees = await container.git.listWorktrees(barePath);
                    if (worktrees.some((wt) => wt.path === wtPath)) {
                      org = bc.org;
                      name = bc.name;
                      break;
                    }
                  } catch { /* ignore */ }
                }
              }
            }

            // If worktree is inside the workspace, move it back to standalone worktrees/
            if (wtPath && org && name && branch && wtPath.startsWith(workspaceBase)) {
              const barePath = container.resolver.barePath(org, name);
              const standalonePath = container.resolver.worktreeDir(org, buildWorktreeDirName(name, branch));
              await container.git.moveWorktree(barePath, wtPath, standalonePath);
              container.logger.info('Worktree moved back from workspace', {
                from: wtPath, to: standalonePath, ticketId: ticket.id,
              });
            }

            // Clean up empty workspace folder
            if (existsSync(workspaceBase)) {
              const entries = readdirSync(workspaceBase).filter((e) => e !== '.DS_Store');
              if (entries.length === 0) {
                rmSync(workspaceBase, { recursive: true, force: true });
                container.logger.info('Cleaned up empty workspace folder', { workspaceBase });
              }
            }
          } catch (err) {
            container.logger.warn('Failed to move worktree back from workspace', {
              ticketId: ticket.id, linkRef: link.ref, error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // When removing a repository link, clean up the worktree from the workspace
        if (link?.type === 'repository') {
          const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
          const workspaceBase = container.resolver.workspacePath(workspaceId);
          try {
            const slashIdx = link.ref.indexOf('/');
            if (slashIdx > 0) {
              const org = link.ref.substring(0, slashIdx);
              const name = link.ref.substring(slashIdx + 1);
              const wtPath = container.resolver.workspaceRepoPath(workspaceId, name);
              if (existsSync(wtPath)) {
                const barePath = container.resolver.barePath(org, name);
                // Resolve the branch before removal so the audit event is informative.
                let branch: string | undefined;
                try {
                  const worktrees = await container.git.listWorktrees(barePath);
                  branch = worktrees.find((wt) => wt.path === wtPath)?.branch;
                } catch {
                  // Best-effort — don't block deletion on a failed branch lookup.
                }
                await container.git.removeWorktree(barePath, wtPath);
                container.logger.info('Worktree removed from workspace on repo unlink', { wtPath, ticketId: ticket.id });
                emit({
                  type: 'worktree.deleted',
                  repoPath: barePath,
                  worktreePath: wtPath,
                  ...(branch ? { branch } : {}),
                  occurredAt: new Date(),
                });
              }
              // Also remove any worktree link that pointed to this repo's workspace path
              const wtLink = ticket.links.find((l) => l.type === 'worktree' && (l.ref === wtPath || l.ref.startsWith(`${org}/${name}:`)));
              if (wtLink) ticket.removeLink(wtLink.id);
            }
            // Clean up empty workspace folder
            if (existsSync(workspaceBase)) {
              const entries = readdirSync(workspaceBase).filter((e) => e !== '.DS_Store');
              if (entries.length === 0) {
                rmSync(workspaceBase, { recursive: true, force: true });
              }
            }
          } catch (err) {
            container.logger.warn('Failed to clean up workspace worktree on repo unlink', {
              ticketId: ticket.id, ref: link.ref, error: err instanceof Error ? err.message : String(err),
            });
          }
        }

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
          emit({
            type: 'ticket.linkRemoved',
            ticketId: ticket.id,
            ...(link ? { linkType: link.type, ref: link.ref, label: link.label } : {}),
            occurredAt: new Date(),
          });
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
      // The action itself is already audited via `session.created`. We only need
      // to refresh the ticket in connected UIs (new session/worktree link),
      // so we broadcast directly instead of emitting an empty `ticket.updated`
      // that would pollute the audit trail with a content-less row.
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (ticket) container.ticketBroadcast('ticket:updated', ticket.toDTO());
      return result;
    });

    // Ensure the ticket's workspace folder exists on disk (idempotent, repo-free).
    // Used by workspace actions so {{workspace_path}} always resolves to a real
    // directory — even for tickets that never had a session (e.g. lead/meeting).
    app.post<{ Params: { id: string } }>('/api/tickets/:id/ensure-workspace', async (request, reply) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
      const workspacePath = container.resolver.workspacePath(workspaceId);
      mkdirSync(workspacePath, { recursive: true });
      const manifestPath = join(workspacePath, '.fleex.json');
      if (!existsSync(manifestPath)) {
        writeFileSync(manifestPath, JSON.stringify({ ticketId: ticket.id }, null, 2));
      }
      return reply.send({ workspacePath });
    });

    // Import GitHub issue
    app.post<{ Body: { org: string; name: string; number: number; boardId: string; status?: TicketStatus; type?: TicketType } }>(
      '/api/tickets/import-github-issue',
      async (request, reply) => {
        const { org, name, number: issueNumber, boardId, status, type } = request.body;
        const ticket = await container.importGitHubIssue.execute(org, name, issueNumber, boardId, { status, type });
        emit({ type: 'ticket.created', ticketId: ticket.id, boardId, occurredAt: new Date() });
        return reply.code(201).send(ticket.toDTO());
      },
    );

    // Import Slack message (single message or thread) as ticket
    app.post<{ Body: { url: string; boardId: string } }>(
      '/api/tickets/import-slack-message',
      async (request, reply) => {
        const { url, boardId } = request.body;
        const ticket = await container.importSlackMessage.execute(url, boardId);
        emit({ type: 'ticket.created', ticketId: ticket.id, boardId, occurredAt: new Date() });
        return reply.code(201).send(ticket.toDTO());
      },
    );

    // Retry a failed background Slack import (re-arms the ticket to pending and re-runs synthesis).
    // The use case emits ticket.updated itself, so the route just returns the re-armed ticket.
    app.post<{ Params: { id: string } }>(
      '/api/tickets/:id/retry-slack-import',
      async (request, reply) => {
        const ticket = await container.importSlackMessage.retry(request.params.id);
        return reply.code(200).send(ticket.toDTO());
      },
    );

    // Import GitHub PR as ticket
    app.post<{ Body: { org: string; name: string; prNumber: number; prTitle: string; headRefName: string; boardId: string } }>(
      '/api/tickets/import-github-pr',
      async (request, reply) => {
        const { org, name, prNumber, prTitle, headRefName, boardId } = request.body;
        const ticket = await container.backfillPRTicket.execute({
          org, name, prNumber, prTitle, headRefName,
          prUrl: `https://github.com/${org}/${name}/pull/${prNumber}`,
          boardId,
          role: 'author',
        });
        emit({ type: 'ticket.created', ticketId: ticket.id, boardId, occurredAt: new Date() });
        return reply.code(201).send(ticket.toDTO());
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
        emit({ type: 'ticket.syncedFromGithub', ticketId: ticket.id, occurredAt: new Date() });
        return ticket.toDTO();
      },
    );

    // Fetch live PR states for a ticket's github_pr links
    app.get<{ Params: { id: string } }>(
      '/api/tickets/:id/pr-states',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const prLinks = ticket.links.filter((l) => l.type === 'github_pr');
        if (prLinks.length === 0) return {};

        const prs = prLinks.map((link) => {
          const match = link.ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
          if (!match) return null;
          return { org: match[1]!, name: match[2]!, number: parseInt(match[3]!, 10) };
        }).filter((p): p is NonNullable<typeof p> => p !== null);

        const stateMap = await container.githubGraphql.fetchPRStates(prs);
        // Return as plain object: { "org/name#123": "OPEN", ... }
        return Object.fromEntries(stateMap);
      },
    );

    // Bulk fetch PR states from refs (e.g. ["org/name#123", ...])
    app.post<{ Body: { refs: string[] } }>(
      '/api/pr-states',
      async (request) => {
        const { refs } = request.body;
        if (!refs || refs.length === 0) return {};

        const prs = refs.map((ref) => {
          const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
          if (!match) return null;
          return { org: match[1]!, name: match[2]!, number: parseInt(match[3]!, 10) };
        }).filter((p): p is NonNullable<typeof p> => p !== null);

        const stateMap = await container.githubGraphql.fetchPRStates(prs);
        return Object.fromEntries(stateMap);
      },
    );

    // Batch reorder
    app.post<{ Body: { updates: { id: string; status: TicketStatus; position: number }[] } }>(
      '/api/tickets/reorder',
      async (request) => {
        for (const upd of request.body.updates) {
          const ticket = await container.ticketStore.getTicketById(upd.id);
          if (!ticket) continue;
          const fromStatus = ticket.status;
          ticket.moveTo(upd.status);
          ticket.position = upd.position;
          ticket.updatedAt = new Date();
          await container.ticketStore.saveTicket(ticket);
          emit({ type: 'ticket.moved', ticketId: upd.id, fromStatus, toStatus: upd.status, occurredAt: new Date() });
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

      const oldStatus = mention.status;
      mention.status = request.body.status;
      if (request.body.status === 'resolved' && !mention.resolvedAt) {
        mention.resolvedAt = new Date();
      } else if (request.body.status !== 'resolved') {
        mention.resolvedAt = null;
      }
      await container.mentionStore.save(mention);

      // Emit the appropriate event based on new status
      const now = new Date();
      if (request.body.status === 'resolved') {
        emit({ type: 'mention.resolved', mentionId: mention.id, ticketId: mention.ticketId, targetAgent: mention.targetAgent, resolvedBy: mention.targetAgent, occurredAt: now });
      } else if (request.body.status === 'waiting_for_info') {
        emit({ type: 'mention.waiting_for_info', mentionId: mention.id, ticketId: mention.ticketId, targetAgent: mention.targetAgent, occurredAt: now });
      } else if (request.body.status === 'acknowledged') {
        emit({ type: 'mention.acknowledged', mentionId: mention.id, ticketId: mention.ticketId, targetAgent: mention.targetAgent, occurredAt: now });
      } else {
        // Generic broadcast for other status changes (e.g. pending)
        container.ticketBroadcast('mention:updated', mention.toDTO());
      }

      return mention.toDTO();
    });

    // POST /api/mentions/:id/run — run this specific mention (▶ button).
    // Mention-scoped: wakes a waiting_for_info mention, enqueues a pending one.
    app.post<{ Params: { id: string } }>('/api/mentions/:id/run', async (request) => {
      const mention = await container.mentionStore.getById(request.params.id);
      if (!mention) throw new MentionNotFoundError(request.params.id);
      return container.executeAgent.runMention(mention);
    });

    // PATCH /api/mentions/:id/execution-mode — update mention execution mode
    app.patch<{
      Params: { id: string };
      Body: { executionMode: MentionExecutionMode };
    }>('/api/mentions/:id/execution-mode', async (request) => {
      const mention = await container.mentionStore.getById(request.params.id);
      if (!mention) throw new MentionNotFoundError(request.params.id);

      const previousMode = mention.executionMode;
      mention.executionMode = request.body.executionMode;
      await container.mentionStore.save(mention);
      container.ticketBroadcast('mention:updated', mention.toDTO());

      if (previousMode !== request.body.executionMode) {
        emit({
          type: 'mention.executionModeChanged',
          mentionId: mention.id,
          ticketId: mention.ticketId,
          from: previousMode,
          to: request.body.executionMode,
          occurredAt: new Date(),
        });
      }

      return mention.toDTO();
    });

    app.delete<{
      Params: { id: string };
    }>('/api/mentions/:id', async (request, reply) => {
      const mention = await container.mentionStore.getById(request.params.id);
      if (!mention) throw new MentionNotFoundError(request.params.id);

      await container.mentionStore.remove(mention.id);
      emit({ type: 'mention.deleted', mentionId: mention.id, ticketId: mention.ticketId, commentId: mention.commentId, occurredAt: new Date() });
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
          emit({ type: 'comment.updated', commentId: comment.id, ticketId: comment.ticketId, createdMentions: [], occurredAt: new Date() });
        }
      }

      await container.mentionStore.remove(mention.id);
      emit({ type: 'mention.deleted', mentionId: mention.id, ticketId: mention.ticketId, commentId: mention.commentId, occurredAt: new Date() });
      return reply.code(204).send();
    });

    // ── Deliverables (web) ──

    // List all deliverables globally (for Documents page)
    app.get<{
      Querystring: { type?: string; agent_name?: string; ticket_id?: string; status?: string };
    }>('/api/deliverables', async (request) => {
      let deliverables = await container.deliverableStore.getAll();

      if (request.query.type) {
        deliverables = deliverables.filter((d) => d.type === request.query.type);
      }
      if (request.query.agent_name) {
        deliverables = deliverables.filter((d) => d.agentName === request.query.agent_name);
      }
      if (request.query.ticket_id) {
        deliverables = deliverables.filter((d) => d.ticketId === request.query.ticket_id);
      }
      if (request.query.status) {
        deliverables = deliverables.filter((d) => d.status === request.query.status);
      }

      return deliverables.map((d) => d.toDTO());
    });

    app.get<{ Params: { id: string } }>('/api/tickets/:id/deliverables', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const deliverables = await container.deliverableStore.getByTicket(request.params.id);
      return deliverables.map((d) => d.toDTO());
    });

    // Create a deliverable from the web UI (no agent auth needed)
    app.post<{
      Params: { id: string };
      Body: { title: string; type: DeliverableType; content: string; status?: DeliverableStatus; agentName?: string };
    }>('/api/tickets/:id/deliverables', async (request, reply) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const agentName = request.body.agentName ?? 'user';
      const deliverable = await container.submitDeliverable.execute({
        ticketId: request.params.id,
        agentName,
        type: request.body.type,
        title: request.body.title,
        content: request.body.content,
        status: request.body.status,
      });

      container.eventBus.emit({
        type: 'deliverable.created',
        deliverableId: deliverable.id,
        ticketId: request.params.id,
        agentName,
        status: deliverable.status,
        title: deliverable.title,
        occurredAt: new Date(),
      });

      return reply.code(201).send(deliverable.toDTO());
    });

    // Get a single deliverable (web)
    app.get<{
      Params: { id: string; delivId: string };
    }>('/api/tickets/:id/deliverables/:delivId', async (request) => {
      const deliverable = await container.deliverableStore.getById(request.params.delivId);
      if (!deliverable) throw new DeliverableNotFoundError(request.params.delivId);
      return deliverable.toDTO();
    });

    // Update a deliverable from the web UI / CLI (no agent auth required;
    // unlike the agent route there is no ownership check — the human/CLI
    // is trusted on the web port).
    app.patch<{
      Params: { id: string; delivId: string };
      Body: { title?: string; content?: string; status?: DeliverableStatus };
    }>('/api/tickets/:id/deliverables/:delivId', async (request) => {
      const deliverable = await container.deliverableStore.getById(request.params.delivId);
      if (!deliverable) throw new DeliverableNotFoundError(request.params.delivId);

      const oldStatus = deliverable.status;
      const deliverableType = deliverable.type;
      deliverable.update(request.body);
      await container.deliverableStore.save(deliverable);

      container.eventBus.emit({
        type: 'deliverable.updated',
        deliverableId: deliverable.id,
        ticketId: deliverable.ticketId,
        agentName: deliverable.agentName,
        oldStatus,
        newStatus: deliverable.status,
        oldType: deliverableType,
        newType: deliverable.type,
        title: deliverable.title,
        occurredAt: new Date(),
      });

      return deliverable.toDTO();
    });

    app.delete<{
      Params: { id: string; delivId: string };
    }>('/api/tickets/:id/deliverables/:delivId', async (request, reply) => {
      const deliverable = await container.deliverableStore.getById(request.params.delivId);
      if (!deliverable) throw new DeliverableNotFoundError(request.params.delivId);

      await container.deliverableStore.remove(request.params.delivId);

      container.eventBus.emit({
        type: 'deliverable.deleted',
        deliverableId: request.params.delivId,
        ticketId: request.params.id,
        occurredAt: new Date(),
      });

      return reply.code(204).send();
    });

    // ── Comments (web) ──

    app.get<{ Params: { id: string } }>('/api/tickets/:id/comments', async (request) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);

      const comments = (await container.commentStore.getByTicket(request.params.id))
        .filter((c) => c.isVisibleTo('user'));

      return comments.map((c) => c.toDTO());
    });

    app.post<{
      Params: { id: string };
      Body: {
        body: string;
        executionMode?: 'talk' | 'plan' | 'edit';
        // How to handle agents that already have an unresolved mention on this
        // ticket (the frontend disambiguates with the user and collects a choice):
        //  - For a waiting_for_info agent (ambiguous: answer vs new subject):
        //    - 'answer': the comment IS the answer → feed the waiting thread, no
        //      duplicate mention.
        //    - 'new_subject': a separate task → create the mention; the agent
        //      keeps waiting for its answer (not woken by this comment).
        //  - For a pending/acknowledged agent (an execution is queued/in flight):
        //    - 'supersede': stop the in-flight run and resolve the prior mention,
        //      then let the fresh mention take over (resuming the same session).
        //    - 'queue': create the new mention; the scheduler runs it after the
        //      current run for this agent+ticket finishes.
        mentionConflicts?: Array<{ agent: string; action: 'answer' | 'new_subject' | 'supersede' | 'queue' }>;
      };
    }>(
      '/api/tickets/:id/comments',
      async (request, reply) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        // ── Resolve mention conflicts before creating the new comment ──
        const ticketMentions = await container.mentionStore.getByTicket(request.params.id);
        const conflicts = request.body.mentionConflicts ?? [];
        const choiceByAgent = new Map(conflicts.map((c) => [c.agent, c.action]));
        const suppressMentionForAgents: string[] = [];
        const wakeExcludeAgents: string[] = [];

        // Mentioning an agent that is currently waiting_for_info is ambiguous:
        // it can be the ANSWER to its question, or a NEW subject. The user
        // disambiguates via a modal (per-agent action), with a safe default when
        // the modal couldn't fire (websocket race): treat it as a new subject so
        // the mention is never lost.
        for (const agent of TicketCommentEntity.extractMentions(request.body.body)) {
          const isWaiting = ticketMentions.some(
            (m) => m.targetType === 'agent' && m.targetAgent === agent && m.status === 'waiting_for_info',
          );
          if (!isWaiting) continue;
          if (choiceByAgent.get(agent) === 'answer') {
            // It's the answer: feed it to the waiting thread (auto-wake) and skip
            // a redundant duplicate mention.
            if (!suppressMentionForAgents.includes(agent)) suppressMentionForAgents.push(agent);
          } else {
            // 'new_subject' or no explicit choice (race default): a separate task.
            // Keep the agent waiting (don't wake it) — its question stays open
            // until the user answers via another message; the new mention queues
            // behind it.
            if (!wakeExcludeAgents.includes(agent)) wakeExcludeAgents.push(agent);
          }
        }

        // Supersede an in-flight / queued run (pending or acknowledged).
        for (const conflict of conflicts) {
          if (conflict.action !== 'supersede') continue;
          const existing = ticketMentions.filter(
            (m) => m.targetType === 'agent' && m.targetAgent === conflict.agent && m.status !== 'resolved',
          );
          for (const m of existing) {
            await container.executeAgent.cancelExecutionForMention(m.id).catch(() => false);
            m.resolve();
            await container.mentionStore.save(m);
            emit({
              type: 'mention.resolved',
              mentionId: m.id,
              ticketId: request.params.id,
              targetAgent: m.targetAgent,
              resolvedBy: m.targetAgent,
              occurredAt: new Date(),
            });
          }
        }
        // 'queue' → no pre-action; the scheduler serializes it after the current run.

        const { humanDisplayName, humanMentionName } = container.config.get();
        const { comment, createdMentions } = await container.postComment.execute({
          ticketId: request.params.id,
          authorType: 'user',
          authorName: humanDisplayName || humanMentionName || 'user',
          body: request.body.body,
          visibility: 'public',
          humanMentionNames: humanMentionName ? [humanMentionName] : [],
          executionMode: request.body.executionMode,
          suppressMentionForAgents,
        });

        // Single event — the DomainEventListener handles broadcasting, auto-trigger, auto-review, wake
        emit({
          type: 'comment.posted',
          commentId: comment.id,
          ticketId: request.params.id,
          authorType: 'user',
          authorName: humanDisplayName || humanMentionName || 'user',
          executionMode: request.body.executionMode,
          wakeExcludeAgents,
          createdMentions: createdMentions.map((m) => ({
            mentionId: m.id,
            targetAgent: m.targetAgent,
            targetType: m.targetType,
          })),
          occurredAt: new Date(),
        });

        // Also emit individual mention.created events for each mention
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

        return reply.code(201).send(comment.toDTO());
      },
    );

    app.delete<{ Params: { id: string; commentId: string } }>(
      '/api/tickets/:id/comments/:commentId',
      async (request, reply) => {
        const comment = await container.commentStore.getById(request.params.commentId);
        if (!comment) throw new CommentNotFoundError(request.params.commentId);

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
      },
    );

    // ── Read Cursors (unread tracking via KvStore) ──

    /** Get read cursors for a specific ticket (comments only — deliverables use per-item seen state) */
    app.get<{ Params: { id: string } }>(
      '/api/tickets/:id/read-cursors',
      async (request) => {
        if (!container.kvStore) return { ticketId: request.params.id, commentLastSeenAt: null };
        const commentCursor = await container.kvStore.get(`read_cursor:comment:${request.params.id}`);
        return {
          ticketId: request.params.id,
          commentLastSeenAt: commentCursor,
        };
      },
    );

    /** Update read cursors for a specific ticket (comments only) */
    app.patch<{
      Params: { id: string };
      Body: { commentLastSeenAt?: string };
    }>(
      '/api/tickets/:id/read-cursors',
      async (request, reply) => {
        if (!container.kvStore) return reply.code(204).send();
        const { commentLastSeenAt } = request.body;
        if (commentLastSeenAt !== undefined) {
          await container.kvStore.set(`read_cursor:comment:${request.params.id}`, commentLastSeenAt);
        }
        return reply.code(204).send();
      },
    );

    // ── Deliverable Seen State (per-deliverable, not cursor-based) ──

    /** Get seen deliverable IDs for a ticket */
    app.get<{ Params: { id: string } }>(
      '/api/tickets/:id/seen-deliverables',
      async (request) => {
        if (!container.kvStore) return [];
        const raw = await container.kvStore.get(`seen_deliverables:${request.params.id}`);
        return raw ? JSON.parse(raw) as string[] : [];
      },
    );

    /** Toggle a deliverable's seen state */
    app.patch<{
      Params: { id: string };
      Body: { deliverableId: string; seen: boolean };
    }>(
      '/api/tickets/:id/seen-deliverables',
      async (request, reply) => {
        if (!container.kvStore) return reply.code(204).send();
        const { deliverableId, seen } = request.body;
        const key = `seen_deliverables:${request.params.id}`;
        const raw = await container.kvStore.get(key);
        const seenIds: string[] = raw ? JSON.parse(raw) : [];
        const set = new Set(seenIds);
        if (seen) {
          set.add(deliverableId);
        } else {
          set.delete(deliverableId);
        }
        await container.kvStore.set(key, JSON.stringify([...set]));
        return reply.code(204).send();
      },
    );

    /** Bulk query: unread counts for tickets (accepts ?ticketIds=id1,id2,...) */
    app.get('/api/tickets/unread-counts', async (request) => {
      if (!container.kvStore) return [];

      // Frontend sends visible ticket IDs — only compute unread for those
      const raw = (request.query as Record<string, string>).ticketIds ?? '';
      const requestedIds = raw ? raw.split(',').filter(Boolean) : [];

      const [commentCursors, seenDeliverableEntries] = await Promise.all([
        container.kvStore.listByPrefix('read_cursor:comment:'),
        container.kvStore.listByPrefix('seen_deliverables:'),
      ]);

      // Build maps
      const commentMap = new Map<string, string>();
      for (const { key, value } of commentCursors) {
        const ticketId = key.replace('read_cursor:comment:', '');
        commentMap.set(ticketId, value);
      }
      const seenDeliverableMap = new Map<string, Set<string>>();
      for (const { key, value } of seenDeliverableEntries) {
        const ticketId = key.replace('seen_deliverables:', '');
        try {
          seenDeliverableMap.set(ticketId, new Set(JSON.parse(value) as string[]));
        } catch {
          seenDeliverableMap.set(ticketId, new Set());
        }
      }

      // Scope: when the frontend requests specific tickets, compute totals for ALL
      // of them (a ticket with no read cursor / seen entry yet is still untracked but
      // must report its real comment/deliverable totals). Only fall back to the set of
      // tracked tickets when no explicit IDs were requested.
      const trackedIds = new Set([...commentMap.keys(), ...seenDeliverableMap.keys()]);
      const ticketIds = requestedIds.length > 0
        ? requestedIds
        : [...trackedIds];

      if (ticketIds.length === 0) return [];

      // Batch fetch: 2 queries instead of N×2
      const [allComments, allDeliverables] = await Promise.all([
        container.commentStore.getByTicketIds(ticketIds),
        container.deliverableStore.getByTicketIds(ticketIds),
      ]);

      // Group by ticketId
      const commentsByTicket = new Map<string, typeof allComments>();
      for (const c of allComments) {
        let arr = commentsByTicket.get(c.ticketId);
        if (!arr) { arr = []; commentsByTicket.set(c.ticketId, arr); }
        arr.push(c);
      }
      const deliverablesByTicket = new Map<string, typeof allDeliverables>();
      for (const d of allDeliverables) {
        let arr = deliverablesByTicket.get(d.ticketId);
        if (!arr) { arr = []; deliverablesByTicket.set(d.ticketId, arr); }
        arr.push(d);
      }

      const results: { ticketId: string; totalComments: number; totalDeliverables: number; unreadComments: number; unreadDeliverables: number }[] = [];
      for (const ticketId of ticketIds) {
        const commentCursor = commentMap.get(ticketId) ?? null;
        const seenSet = seenDeliverableMap.get(ticketId) ?? new Set<string>();
        const comments = commentsByTicket.get(ticketId) ?? [];
        const deliverables = deliverablesByTicket.get(ticketId) ?? [];

        const unreadComments = commentCursor
          ? comments.filter((c) => c.createdAt > new Date(commentCursor)).length
          : comments.length;
        const unreadDeliverables = deliverables.filter((d) => !seenSet.has(d.id)).length;

        results.push({ ticketId, totalComments: comments.length, totalDeliverables: deliverables.length, unreadComments, unreadDeliverables });
      }

      return results;
    });

    /**
     * Bulk query: real-time agentic activity for tickets (accepts ?ticketIds=id1,id2,...).
     * Powers the Kanban card activity pill (#381). Board-scoped: the frontend sends the
     * visible ticket IDs and gets back one entry each (including `idle`), so the response
     * is authoritative and the client can self-clean stale pills.
     */
    app.get('/api/tickets/agent-activity', async (request) => {
      const raw = (request.query as Record<string, string>).ticketIds ?? '';
      const requestedIds = raw ? raw.split(',').filter(Boolean) : [];
      if (requestedIds.length === 0) return [];

      const requested = new Set(requestedIds);

      // Workflow stores are optional (only wired when workflow templates exist).
      const [executions, mentions, runningRuns, needsReviewRuns, blockedRuns] = await Promise.all([
        container.agentEventStore.getAllExecutions(),
        container.mentionStore.getAll(),
        container.workflowRunStore?.getByStatus('running') ?? Promise.resolve([]),
        container.workflowRunStore?.getByStatus('needs_review') ?? Promise.resolve([]),
        container.workflowRunStore?.getByStatus('blocked') ?? Promise.resolve([]),
      ]);

      const runningExecutions = executions.filter(
        (e) => e.status === 'running' && requested.has(e.ticketId),
      );
      const waitingMentions = mentions.filter(
        (m) => m.status === 'waiting_for_info' && requested.has(m.ticketId),
      );
      const scopedRunningRuns = runningRuns.filter((r) => requested.has(r.ticketId));
      const gateRuns = [...needsReviewRuns, ...blockedRuns].filter((r) =>
        requested.has(r.ticketId),
      );

      // When each waiting mention's question was posed = the completion of the
      // execution that carried it (pass 5 "Waiting for {{age}}"). Latest wins
      // if a mention somehow ran twice.
      const executionCompletedAtByMentionId = new Map<string, string>();
      for (const e of executions) {
        if (!e.mentionId || !e.completedAt) continue;
        const prev = executionCompletedAtByMentionId.get(e.mentionId);
        if (!prev || e.completedAt > prev) {
          executionCompletedAtByMentionId.set(e.mentionId, e.completedAt);
        }
      }
      // Workflow-run / mention entities carry Date fields; the derivation
      // compares ISO strings (like executions do), so normalize here.
      const { runningSinceByTicket, waitingSinceByTicket } = deriveActivitySince({
        runningExecutions,
        runningWorkflowRuns: scopedRunningRuns.map((r) => ({
          ticketId: r.ticketId,
          startedAt: r.startedAt.toISOString(),
        })),
        waitingMentions: waitingMentions.map((m) => ({
          ticketId: m.ticketId,
          id: m.id,
          createdAt: m.createdAt.toISOString(),
        })),
        executionCompletedAtByMentionId,
        gateWorkflowRuns: gateRuns.map((r) => ({
          ticketId: r.ticketId,
          updatedAt: r.updatedAt.toISOString(),
        })),
      });

      // Last SDK activity per ticket → the cockpit's "idle since {{age}}" (#400).
      // CLI sessions are excluded (NaS spec'd "dernière exécution du sdk"); a
      // NULL source reads as sdk. Freshest signal wins: completedAt, else the
      // last streamed event, else the start.
      const lastSdkActivityAtByTicket = new Map<string, string>();
      for (const e of executions) {
        if (e.source === 'cli' || !requested.has(e.ticketId)) continue;
        const ts = e.completedAt ?? e.lastEventAt ?? e.startedAt;
        const prev = lastSdkActivityAtByTicket.get(e.ticketId);
        if (!prev || ts > prev) lastSdkActivityAtByTicket.set(e.ticketId, ts);
      }

      // Cumulative agentic cost per ticket (#404): sum every execution's costUsd,
      // ALL origins (sdk + cli) and ALL statuses, treating null as 0 — same
      // accumulation get-statistics uses for totalCostUsd. "Cumulé" = every
      // dollar an agent spent on the ticket.
      const costByTicket = new Map<string, number>();
      for (const e of executions) {
        if (!requested.has(e.ticketId)) continue;
        costByTicket.set(e.ticketId, (costByTicket.get(e.ticketId) ?? 0) + (e.costUsd ?? 0));
      }

      return deriveTicketAgentActivity(requestedIds, {
        runningExecutionTicketIds: runningExecutions.map((e) => e.ticketId),
        runningWorkflowTicketIds: scopedRunningRuns.map((r) => r.ticketId),
        waitingMentionTicketIds: waitingMentions.map((m) => m.ticketId),
        waitingWorkflowTicketIds: gateRuns.map((r) => r.ticketId),
        lastSdkActivityAtByTicket,
        runningSinceByTicket,
        waitingSinceByTicket,
        costByTicket,
      });
    });
  };
}

const FILE_URL_PATTERN = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

function extractFileIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(FILE_URL_PATTERN)) {
    ids.add(match[1]!);
  }
  return Array.from(ids);
}
