import { SessionEntity } from '../../domain/entities.js';
import { sessionIdFromTmuxName } from '../../domain/services/session-id.js';

import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { SessionNamingService } from '../../domain/services/session-naming.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { TmuxPort, TmuxSessionInfo } from '../ports/tmux.port.js';

export class DiscoverExistingSessionsUseCase {
  constructor(
    private readonly tmux: TmuxPort,
    private readonly sessionStore: SessionStorePort,
    private readonly namingService: SessionNamingService,
    private readonly logger: LoggerPort,
    private readonly git?: GitPort,
    private readonly resolver?: RepoPathResolver,
    private readonly ticketStore?: TicketStorePort,
  ) {}

  async execute(prefetchedSessions?: TmuxSessionInfo[]): Promise<void> {
    const managed = prefetchedSessions ?? (await this.tmux.listManagedSessions());

    for (const tmuxSession of managed) {
      const existing = await this.sessionStore.getByTmuxName(tmuxSession.name);
      if (existing) continue;

      const type = this.namingService.parseType(tmuxSession.name);
      if (!type) continue;

      const metadata = await this.resolveMetadata(tmuxSession.name);

      const extractedDisplayName = this.namingService.extractDisplayName(tmuxSession.name);

      const session = new SessionEntity(
        sessionIdFromTmuxName(tmuxSession.name),
        tmuxSession.name,
        type,
        'running',
        metadata.cwd,
        new Date(Number(tmuxSession.created) * 1000),
        null,
        metadata.repositoryOrg,
        metadata.repositoryName,
        metadata.worktreeBranch,
        metadata.gitRemote,
        undefined,
        extractedDisplayName,
      );

      await this.sessionStore.save(session);
      this.logger.info('Discovered existing session', {
        id: session.id,
        tmuxName: tmuxSession.name,
        type,
        cwd: metadata.cwd || undefined,
        repositoryOrg: metadata.repositoryOrg || undefined,
        repositoryName: metadata.repositoryName || undefined,
      });
    }
  }

  private async resolveMetadata(tmuxName: string): Promise<{
    cwd: string;
    repositoryOrg: string | null;
    repositoryName: string | null;
    worktreeBranch: string | null;
    gitRemote: string | null;
  }> {
    let cwd = '';
    let repositoryOrg: string | null = null;
    let repositoryName: string | null = null;
    let worktreeBranch: string | null = null;
    let gitRemote: string | null = null;

    const paneCwd = await this.tmux.getSessionCwd(tmuxName);
    if (paneCwd) {
      cwd = paneCwd;

      // Try manifest-based resolution first (zero network, reads from filesystem + memory cache)
      if (this.resolver && this.ticketStore) {
        const manifest = this.resolver.resolveManifest(paneCwd);
        if (manifest?.ticketId) {
          const ticket = await this.ticketStore.getTicketById(manifest.ticketId);
          if (ticket) {
            const repoLink = ticket.links.find((l) => l.type === 'repository');
            if (repoLink) {
              const slashIdx = repoLink.ref.indexOf('/');
              if (slashIdx > 0) {
                repositoryOrg = repoLink.ref.substring(0, slashIdx);
                repositoryName = repoLink.ref.substring(slashIdx + 1);
              }
            }
            const wtLink = ticket.links.find((l) => l.type === 'worktree');
            if (wtLink) {
              worktreeBranch = wtLink.label;
            }
            return { cwd, repositoryOrg, repositoryName, worktreeBranch, gitRemote };
          }
        }
      }

      // Fallback to git info for non-workspace sessions
      if (this.git) {
        try {
          const info = await this.git.getInfo(paneCwd);
          repositoryOrg = info.org;
          repositoryName = info.name;
          worktreeBranch = info.branch;
          gitRemote = info.remote;
        } catch {
          // Not a git repo — leave metadata null
        }
      }
    }

    return { cwd, repositoryOrg, repositoryName, worktreeBranch, gitRemote };
  }
}
