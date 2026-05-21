import type { SessionGroup, WorktreeSessionGroup } from '@fleex/shared';
import type { SessionEntity } from '../entities.js';
import type { RepoPathResolver } from './repo-path-resolver.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';

interface TicketInfo {
  ticketId: string;
  title: string;
  repoCount: number;
  firstOrg: string | null;
  firstName: string | null;
}

export class SessionGroupingService {
  constructor(
    private readonly resolver?: RepoPathResolver,
    private readonly ticketStore?: TicketStorePort,
  ) {}

  async groupSessions(sessions: SessionEntity[]): Promise<SessionGroup[]> {
    // Resolve ticket info for workspace sessions via manifest
    const ticketCache = new Map<string, TicketInfo | null>();
    const sessionTickets = new Map<string, TicketInfo>();

    // Sessions inside workspaces/ whose ticket no longer exists should be excluded entirely
    const orphanSessionIds = new Set<string>();

    for (const session of sessions) {
      if (this.resolver && this.ticketStore) {
        const inWorkspace = session.cwd.startsWith(this.resolver.workspacesRoot());
        const manifest = this.resolver.resolveManifest(session.cwd);
        if (manifest?.ticketId) {
          let info = ticketCache.get(manifest.ticketId);
          if (info === undefined) {
            const ticket = await this.ticketStore.getTicketById(manifest.ticketId);
            if (ticket) {
              const repoLinks = ticket.links.filter((l) => l.type === 'repository');
              const firstRepo = repoLinks[0];
              let firstOrg: string | null = null;
              let firstName: string | null = null;
              if (firstRepo) {
                const si = firstRepo.ref.indexOf('/');
                if (si > 0) {
                  firstOrg = firstRepo.ref.substring(0, si);
                  firstName = firstRepo.ref.substring(si + 1);
                }
              }
              info = { ticketId: ticket.id, title: ticket.title, repoCount: repoLinks.length, firstOrg, firstName };
            } else {
              info = null;
            }
            ticketCache.set(manifest.ticketId, info);
          }
          if (info) {
            sessionTickets.set(session.id, info);
          } else {
            // Ticket was deleted — exclude this workspace session
            orphanSessionIds.add(session.id);
          }
        } else if (inWorkspace) {
          // Inside workspaces/ but no manifest (directory deleted) — exclude
          orphanSessionIds.add(session.id);
        }
      }
    }

    // Group:
    // - Has manifest + 1 repo → under that repo, worktree label = ticket title
    // - Has manifest + 2+ repos → under "_multi-repo", worktree label = ticket title
    // - Has manifest + 0 repos → under "_unassigned", worktree label = ticket title
    // - No manifest + has git info → under repo (legacy), worktree label = branch
    // - No manifest + no git info → _ungrouped (system/shell)
    const repoMap = new Map<string, Map<string, SessionEntity[]>>();

    for (const session of sessions) {
      // Skip orphaned workspace sessions (ticket deleted or workspace removed)
      if (orphanSessionIds.has(session.id)) continue;

      const ticketInfo = sessionTickets.get(session.id);
      let groupOrg: string;
      let groupName: string;
      let label: string;

      if (ticketInfo) {
        if (ticketInfo.repoCount === 0) {
          groupOrg = '_unassigned';
          groupName = '_unassigned';
        } else if (ticketInfo.repoCount === 1 && ticketInfo.firstOrg && ticketInfo.firstName) {
          groupOrg = ticketInfo.firstOrg;
          groupName = ticketInfo.firstName;
        } else {
          groupOrg = '_multi-repo';
          groupName = '_multi-repo';
        }
        label = ticketInfo.title;
      } else {
        groupOrg = session.repositoryOrg ?? '_ungrouped';
        groupName = session.repositoryName ?? '_ungrouped';
        label = session.worktreeBranch ?? '_default';
      }

      const repoKey = `${groupOrg}/${groupName}`;
      let labelMap = repoMap.get(repoKey);
      if (!labelMap) {
        labelMap = new Map();
        repoMap.set(repoKey, labelMap);
      }
      let labelSessions = labelMap.get(label);
      if (!labelSessions) {
        labelSessions = [];
        labelMap.set(label, labelSessions);
      }
      labelSessions.push(session);
    }

    const groups: SessionGroup[] = [];
    for (const [repoKey, labelMap] of repoMap) {
      const [org, name] = repoKey.split('/') as [string, string];
      const worktrees: WorktreeSessionGroup[] = [];
      for (const [label, labelSessions] of labelMap) {
        const tId = labelSessions[0] ? sessionTickets.get(labelSessions[0].id)?.ticketId : undefined;
        worktrees.push({
          branch: label,
          path: labelSessions[0]?.cwd ?? '',
          sessions: labelSessions.map((s) => s.toDTO()),
          ...(tId ? { ticketId: tId } : {}),
        });
      }
      groups.push({ repositoryOrg: org, repositoryName: name, worktrees });
    }
    return groups;
  }
}
