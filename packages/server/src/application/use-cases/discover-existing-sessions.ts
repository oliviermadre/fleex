import { randomUUID } from 'node:crypto';
import { SessionEntity } from '../../domain/entities.js';
import { SessionNamingService } from '../../domain/services/session-naming.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class DiscoverExistingSessionsUseCase {
  constructor(
    private readonly tmux: TmuxPort,
    private readonly sessionStore: SessionStorePort,
    private readonly namingService: SessionNamingService,
    private readonly logger: LoggerPort,
    private readonly git?: GitPort,
  ) {}

  async execute(): Promise<void> {
    const managed = await this.tmux.listManagedSessions();

    for (const tmuxSession of managed) {
      const existing = this.sessionStore.getByTmuxName(tmuxSession.name);
      if (existing) continue;

      const type = this.namingService.parseType(tmuxSession.name);
      if (!type) continue;

      const metadata = await this.resolveMetadata(tmuxSession.name);

      const extractedDisplayName = this.namingService.extractDisplayName(tmuxSession.name);

      const session = new SessionEntity(
        randomUUID(),
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

    // Re-enrich existing sessions that are missing metadata (e.g. discovered before a bug fix)
    for (const session of this.sessionStore.getAll()) {
      if (session.repositoryOrg || session.status === 'dead') continue;

      const metadata = await this.resolveMetadata(session.tmuxName);
      if (!metadata.repositoryOrg) continue;

      const enriched = new SessionEntity(
        session.id,
        session.tmuxName,
        session.type,
        session.status,
        metadata.cwd || session.cwd,
        session.createdAt,
        session.lastAttachedAt,
        metadata.repositoryOrg,
        metadata.repositoryName,
        metadata.worktreeBranch,
        metadata.gitRemote,
        session.claudePrompt,
        session.displayName,
      );

      await this.sessionStore.save(enriched);
      this.logger.info('Re-enriched session metadata', {
        id: session.id,
        tmuxName: session.tmuxName,
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
      if (this.git) {
        try {
          const info = await this.git.getInfo(paneCwd);
          repositoryOrg = info.org;
          repositoryName = info.name;
          worktreeBranch = info.branch;
          gitRemote = info.remote;
        } catch {
          // Not a git repo or git not available — leave metadata null
        }
      }
    }

    return { cwd, repositoryOrg, repositoryName, worktreeBranch, gitRemote };
  }
}
