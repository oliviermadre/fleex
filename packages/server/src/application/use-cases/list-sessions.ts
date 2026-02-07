import type { SessionEntity } from '../../domain/entities.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class ListSessionsUseCase {
  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly tmux: TmuxPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<SessionEntity[]> {
    const sessions = this.sessionStore.getAll();
    const tmuxSessions = await this.tmux.listManagedSessions();
    const tmuxNames = new Set(tmuxSessions.map((s) => s.name));

    for (const session of sessions) {
      if (session.status === 'running' && !tmuxNames.has(session.tmuxName)) {
        session.markDead();
        this.sessionStore.save(session);
        this.logger.debug('Session marked dead (tmux session gone)', {
          id: session.id,
          tmuxName: session.tmuxName,
        });
      }
    }

    return sessions;
  }
}
