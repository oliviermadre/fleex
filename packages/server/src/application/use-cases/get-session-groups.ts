import type { SessionGroup } from '@asm/shared';
import type { SessionEntity } from '../../domain/entities.js';
import { SessionGroupingService } from '../../domain/services/session-grouping.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { ListSessionsUseCase } from './list-sessions.js';
import type { EnrichClaudeActivityUseCase } from './enrich-claude-activity.js';
import type { DiscoverExistingSessionsUseCase } from './discover-existing-sessions.js';

export class GetSessionGroupsUseCase {
  private readonly listSessions: ListSessionsUseCase;

  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly tmux: TmuxPort,
    private readonly groupingService: SessionGroupingService,
    private readonly logger: LoggerPort,
    private readonly enrichClaudeActivity?: EnrichClaudeActivityUseCase,
    private readonly discoverSessions?: DiscoverExistingSessionsUseCase,
  ) {
    this.listSessions = new ListSessionsUseCase(sessionStore, tmux, logger);
  }

  async execute(): Promise<SessionGroup[]> {
    // Single tmux call to get both managed sessions and pane commands
    let paneCommands: Map<string, string>;
    let sessions: SessionEntity[];
    try {
      const combined = await this.tmux.listManagedSessionsWithPaneCommands();
      // Discover any new asm_* sessions not yet in store (reuses pre-fetched list, no extra tmux call)
      await this.discoverSessions?.execute(combined.sessions);
      sessions = await this.listSessions.execute(combined.sessions);
      paneCommands = combined.paneCommands;
    } catch (err) {
      this.logger.debug('Failed combined tmux call, falling back', { error: String(err) });
      sessions = await this.listSessions.execute();
      paneCommands = new Map();
    }

    // Enrich foreground process from pane commands
    for (const session of sessions) {
      const command = paneCommands.get(session.tmuxName);
      if (command) {
        session.foregroundProcess = command;
      }
    }

    if (this.enrichClaudeActivity) {
      try {
        const activityMap = await this.enrichClaudeActivity.execute(sessions);
        for (const session of sessions) {
          const activity = activityMap.get(session.id);
          if (activity) {
            session.claudeActivity = activity;
          }
        }
      } catch (err) {
        this.logger.debug('Failed to enrich claude activity', { error: String(err) });
      }
    }

    return this.groupingService.groupSessions(sessions);
  }
}
