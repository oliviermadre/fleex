import { randomUUID } from 'node:crypto';
import { SessionEntity } from '../../domain/entities.js';
import { SessionNamingService } from '../../domain/services/session-naming.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class DiscoverExistingSessionsUseCase {
  constructor(
    private readonly tmux: TmuxPort,
    private readonly sessionStore: SessionStorePort,
    private readonly namingService: SessionNamingService,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<void> {
    const managed = await this.tmux.listManagedSessions();

    for (const tmuxSession of managed) {
      const existing = this.sessionStore.getByTmuxName(tmuxSession.name);
      if (existing) continue;

      const type = this.namingService.parseType(tmuxSession.name);
      if (!type) continue;

      const session = new SessionEntity(
        randomUUID(),
        tmuxSession.name,
        type,
        'running',
        '',
        new Date(tmuxSession.created),
        null,
        null,
        null,
        null,
        null,
      );

      this.sessionStore.save(session);
      this.logger.info('Discovered existing session', {
        id: session.id,
        tmuxName: tmuxSession.name,
        type,
      });
    }
  }
}
