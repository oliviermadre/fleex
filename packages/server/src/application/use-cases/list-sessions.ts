import type { SessionEntity } from '../../domain/entities.js';
import type { TmuxPort, TmuxSessionInfo } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class ListSessionsUseCase {
  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly tmux: TmuxPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(prefetchedTmuxSessions?: TmuxSessionInfo[]): Promise<SessionEntity[]> {
    const sessions = await this.sessionStore.getAll();

    let tmuxSessions: TmuxSessionInfo[];
    if (prefetchedTmuxSessions) {
      tmuxSessions = prefetchedTmuxSessions;
    } else {
      try {
        tmuxSessions = await this.tmux.listManagedSessions();
      } catch (err) {
        this.logger.warn('Failed to list tmux sessions, skipping cleanup', {
          error: err instanceof Error ? err.message : String(err),
        });
        return sessions;
      }
    }

    const tmuxNames = new Set(tmuxSessions.map((s) => s.name));

    const alive: SessionEntity[] = [];

    for (const session of sessions) {
      if (!tmuxNames.has(session.tmuxName)) {
        // Tmux session is gone — remove from store
        await this.sessionStore.remove(session.id);
        this.logger.debug('Removed dead session (tmux session gone)', {
          id: session.id,
          tmuxName: session.tmuxName,
        });
      } else {
        alive.push(session);
      }
    }

    return alive;
  }
}
