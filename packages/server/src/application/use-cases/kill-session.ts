import { SessionNotFoundError } from '../../domain/errors.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class KillSessionUseCase {
  constructor(
    private readonly tmux: TmuxPort,
    private readonly sessionStore: SessionStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(sessionId: string): Promise<void> {
    const session = await this.sessionStore.getById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    try {
      await this.tmux.killSession(session.tmuxName);
    } catch {
      this.logger.warn('Failed to kill tmux session (may already be dead)', {
        tmuxName: session.tmuxName,
      });
    }

    await this.sessionStore.remove(sessionId);
    this.logger.info('Session killed', { id: sessionId, tmuxName: session.tmuxName });
  }
}
