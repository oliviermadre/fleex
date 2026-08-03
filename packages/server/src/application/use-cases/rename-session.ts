import { SessionNotFoundError } from '../../domain/errors.js';

import type { SessionNamingService } from '../../domain/services/session-naming.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { TmuxPort } from '../ports/tmux.port.js';

export class RenameSessionUseCase {
  constructor(
    private readonly tmux: TmuxPort,
    private readonly sessionStore: SessionStorePort,
    private readonly namingService: SessionNamingService,
    private readonly logger: LoggerPort,
  ) {}

  async execute(sessionId: string, newDisplayName: string): Promise<void> {
    const session = await this.sessionStore.getById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    const context = {
      org: session.repositoryOrg,
      repo: session.repositoryName,
      worktree: session.worktreeBranch,
    };

    // Gather sibling tmux names, excluding self
    const storedNames = (await this.sessionStore.getAll())
      .filter((s) => s.id !== sessionId)
      .map((s) => s.tmuxName);
    const liveSessions = await this.tmux.listManagedSessions();
    const liveNames = liveSessions.filter((s) => s.name !== session.tmuxName).map((s) => s.name);
    const existingTmuxNames = [...new Set([...storedNames, ...liveNames])];

    const { displayName, tmuxName } = this.namingService.resolveUniqueName(
      newDisplayName,
      session.type,
      context,
      existingTmuxNames,
    );

    if (tmuxName === session.tmuxName) {
      // Name unchanged, just update displayName if different
      if (displayName !== session.displayName) {
        session.rename(tmuxName, displayName);
        await this.sessionStore.save(session);
      }
      return;
    }

    await this.tmux.renameSession(session.tmuxName, tmuxName);
    session.rename(tmuxName, displayName);
    await this.sessionStore.save(session);

    this.logger.info('Session renamed', {
      id: sessionId,
      oldTmuxName: session.tmuxName,
      newTmuxName: tmuxName,
      displayName,
    });
  }
}
