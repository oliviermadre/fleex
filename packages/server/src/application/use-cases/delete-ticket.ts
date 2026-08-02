import { existsSync, rmSync } from 'node:fs';
import { buildTicketWorkspaceId } from '../../domain/services/branch-utils.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { FileStorePort } from '../ports/file-store.port.js';
import type { FileMetaStorePort } from '../ports/file-meta-store.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { KillSessionUseCase } from './kill-session.js';
import type { EventBus } from '../event-bus.js';
import { extractFileIds } from '../utils/extract-file-ids.js';
import type { TicketActor } from './ticket-actor.js';

export interface DeleteTicketInput {
  ticketId: string;
  actor: TicketActor;
}

/**
 * Single write path for ticket deletion (web UI + agent API).
 *
 * Deleting a ticket also disposes of everything it spawned: uploaded files, live
 * sessions, git worktrees and the workspace folder. The agent API skipped all of
 * it and leaked worktrees + workspaces on disk; unifying here is the fix.
 *
 * Every cleanup step is best-effort — a failure to reclaim a resource must never
 * prevent the ticket itself from being deleted.
 */
export class DeleteTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly fileStore: FileStorePort,
    private readonly fileMetaStore: FileMetaStorePort,
    private readonly sessionStore: SessionStorePort,
    private readonly killSession: KillSessionUseCase,
    private readonly git: GitPort,
    private readonly resolver: RepoPathResolver,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: DeleteTicketInput): Promise<void> {
    const { ticketId } = input;
    const ticket = await this.ticketStore.getTicketById(ticketId);

    // Cleanup uploaded files referenced in ticket description + comments
    try {
      const comments = await this.commentStore.getByTicket(ticketId);
      const allText = [ticket?.description ?? '', ...comments.map((c) => c.body)].join('\n');
      const fileIds = extractFileIds(allText);
      await Promise.all(fileIds.map(async (fid) => {
        await this.fileStore.remove(fid).catch(() => {});
        await this.fileMetaStore.remove(fid).catch(() => {});
      }));
    } catch {
      // Best-effort cleanup — don't block ticket deletion
    }

    // Cleanup workspace: remove git worktrees, kill sessions, delete workspace folder
    if (ticket) {
      const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
      const workspaceBase = this.resolver.workspacePath(workspaceId);

      try {
        // Kill sessions whose cwd is inside the workspace
        const allSessions = await this.sessionStore.getAll();
        const workspaceSessions = allSessions.filter((s) => s.cwd.startsWith(workspaceBase));
        await Promise.all(workspaceSessions.map(async (s) => {
          await this.killSession.execute(s.id).catch(() => {});
        }));

        // Remove git worktrees for each repo linked to this ticket
        for (const link of ticket.links) {
          if (link.type === 'repository') {
            const slashIdx = link.ref.indexOf('/');
            if (slashIdx > 0) {
              const org = link.ref.substring(0, slashIdx);
              const name = link.ref.substring(slashIdx + 1);
              const wtPath = this.resolver.workspaceRepoPath(workspaceId, name);
              if (existsSync(wtPath)) {
                const barePath = this.resolver.barePath(org, name);
                // Resolve the branch before removal so the audit event is informative.
                let branch: string | undefined;
                try {
                  const worktrees = await this.git.listWorktrees(barePath);
                  branch = worktrees.find((wt) => wt.path === wtPath)?.branch;
                } catch {
                  // Best-effort — don't block deletion on a failed branch lookup.
                }
                try {
                  await this.git.removeWorktree(barePath, wtPath);
                  this.eventBus.emit({
                    type: 'worktree.deleted',
                    repoPath: barePath,
                    worktreePath: wtPath,
                    ...(branch ? { branch } : {}),
                    occurredAt: new Date(),
                  });
                } catch (err) {
                  this.logger.warn('Failed to remove worktree on ticket delete', {
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
          this.logger.info('Workspace cleaned up on ticket delete', { workspaceBase, ticketId });
        }
      } catch (err) {
        this.logger.warn('Failed to cleanup workspace on ticket delete', {
          ticketId, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.ticketStore.removeTicket(ticketId);
    this.eventBus.emit({
      type: 'ticket.deleted',
      ticketId,
      source: input.actor.source,
      ...(input.actor.executionId ? { executionId: input.actor.executionId } : {}),
      occurredAt: new Date(),
    });
  }
}
