import { SessionNamingService } from '../domain/services/session-naming.js';
import { SessionGroupingService } from '../domain/services/session-grouping.js';
import { CreateSessionUseCase } from '../application/use-cases/create-session.js';
import { ListSessionsUseCase } from '../application/use-cases/list-sessions.js';
import { KillSessionUseCase } from '../application/use-cases/kill-session.js';
import { GetSessionGroupsUseCase } from '../application/use-cases/get-session-groups.js';
import { DiscoverExistingSessionsUseCase } from '../application/use-cases/discover-existing-sessions.js';
import { ListRepositoriesUseCase } from '../application/use-cases/list-repositories.js';
import { ListWorktreesUseCase } from '../application/use-cases/list-worktrees.js';
import { CreateWorktreeUseCase } from '../application/use-cases/create-worktree.js';
import { EnrichClaudeActivityUseCase } from '../application/use-cases/enrich-claude-activity.js';
import { TmuxCliAdapter } from './adapters/tmux-cli.adapter.js';
import { NodePtyAdapter } from './adapters/node-pty.adapter.js';
import { GitCliAdapter } from './adapters/git-cli.adapter.js';
import { JsonSessionStore } from './adapters/json-session-store.adapter.js';
import { JsonConfigAdapter } from './adapters/json-config.adapter.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.adapter.js';
import { ClaudeStateAdapter } from './adapters/claude-state.adapter.js';

export function createContainer() {
  const logger = new PinoLoggerAdapter();
  const config = new JsonConfigAdapter();
  const tmux = new TmuxCliAdapter(logger);
  const ptyAdapter = new NodePtyAdapter(logger);
  const git = new GitCliAdapter(logger);
  const sessionStore = new JsonSessionStore(logger);
  const namingService = new SessionNamingService();
  const groupingService = new SessionGroupingService();
  const claudeState = new ClaudeStateAdapter(logger);

  const enrichClaudeActivity = new EnrichClaudeActivityUseCase(claudeState, logger);

  return {
    logger,
    config,
    tmux,
    pty: ptyAdapter,
    git,
    sessionStore,
    createSession: new CreateSessionUseCase(tmux, sessionStore, namingService, git, config, logger),
    listSessions: new ListSessionsUseCase(sessionStore, tmux, logger),
    killSession: new KillSessionUseCase(tmux, sessionStore, logger),
    getSessionGroups: new GetSessionGroupsUseCase(sessionStore, tmux, groupingService, logger, enrichClaudeActivity),
    discoverSessions: new DiscoverExistingSessionsUseCase(tmux, sessionStore, namingService, logger),
    listRepositories: new ListRepositoriesUseCase(git, config, logger),
    listWorktrees: new ListWorktreesUseCase(git, logger),
    createWorktree: new CreateWorktreeUseCase(git, logger),
  };
}

export type Container = ReturnType<typeof createContainer>;
