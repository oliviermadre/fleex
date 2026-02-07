import type { SessionGroup } from '@asm/shared';
import { SessionGroupingService } from '../../domain/services/session-grouping.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { ListSessionsUseCase } from './list-sessions.js';

export class GetSessionGroupsUseCase {
  private readonly listSessions: ListSessionsUseCase;

  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly tmux: TmuxPort,
    private readonly groupingService: SessionGroupingService,
    private readonly logger: LoggerPort,
  ) {
    this.listSessions = new ListSessionsUseCase(sessionStore, tmux, logger);
  }

  async execute(): Promise<SessionGroup[]> {
    const sessions = await this.listSessions.execute();
    return this.groupingService.groupSessions(sessions);
  }
}
