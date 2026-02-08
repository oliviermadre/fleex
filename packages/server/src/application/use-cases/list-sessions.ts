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
