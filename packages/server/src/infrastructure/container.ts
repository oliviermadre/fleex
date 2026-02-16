import { homedir } from 'node:os';
import { SessionNamingService } from '../domain/services/session-naming.js';
import { SessionGroupingService } from '../domain/services/session-grouping.js';
import { RepositoryCache } from '../domain/services/repository-cache.js';
import { RepositoryRefreshScheduler } from '../domain/services/repository-refresh-scheduler.js';
import { CreateSessionUseCase } from '../application/use-cases/create-session.js';
import { ListSessionsUseCase } from '../application/use-cases/list-sessions.js';
import { KillSessionUseCase } from '../application/use-cases/kill-session.js';
import { GetSessionGroupsUseCase } from '../application/use-cases/get-session-groups.js';
import { DiscoverExistingSessionsUseCase } from '../application/use-cases/discover-existing-sessions.js';
import { ListRepositoriesUseCase } from '../application/use-cases/list-repositories.js';
import { ListWorktreesUseCase } from '../application/use-cases/list-worktrees.js';
import { CreateWorktreeUseCase } from '../application/use-cases/create-worktree.js';
import { EnrichClaudeActivityUseCase } from '../application/use-cases/enrich-claude-activity.js';
import { GetClaudeUsageUseCase } from '../application/use-cases/get-claude-usage.js';
import { JsonTicketStore } from './adapters/json-ticket-store.adapter.js';
import { JsonAgentTokenStore } from './adapters/json-agent-token-store.adapter.js';
import { CreateSessionFromTicketUseCase } from '../application/use-cases/create-session-from-ticket.js';
import { DetectMergeUseCase } from '../application/use-cases/detect-merge.js';
import { ImportGitHubIssueUseCase } from '../application/use-cases/import-github-issue.js';
import { TmuxCliAdapter } from './adapters/tmux-cli.adapter.js';
import { GitCliAdapter } from './adapters/git-cli.adapter.js';
import { GitHubGraphQLAdapter } from './adapters/github-graphql.adapter.js';
import { JsonSessionStore } from './adapters/json-session-store.adapter.js';
import { JsonConfigAdapter } from './adapters/json-config.adapter.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.adapter.js';
import { ClaudeStateAdapter } from './adapters/claude-state.adapter.js';
import { TmuxClaudeUsageAdapter } from './adapters/tmux-claude-usage.adapter.js';
import { localExec, localShellExec, LocalHostFs } from './host/local.js';
import { remoteExec, remoteShellExec, RemoteHostFs } from './host/remote.js';
import { RemotePtyAdapter } from './host/remote-pty.adapter.js';
import type { ExecFn, ShellExecFn, HostFs } from './host/types.js';
import type { PtyPort } from '../application/ports/pty.port.js';

export async function createContainer() {
  const logger = new PinoLoggerAdapter();

  const gatewayUrl = process.env['HOST_GATEWAY_URL'];
  const hostHomedir = process.env['HOST_HOMEDIR'] || homedir();

  let execFn: ExecFn;
  let shellExecFn: ShellExecFn;
  let hostFs: HostFs;
  let ptyAdapter: PtyPort;

  if (gatewayUrl) {
    execFn = remoteExec(gatewayUrl);
    shellExecFn = remoteShellExec(gatewayUrl);
    hostFs = new RemoteHostFs(gatewayUrl);
    ptyAdapter = new RemotePtyAdapter(gatewayUrl, logger);
  } else {
    execFn = localExec;
    shellExecFn = localShellExec;
    hostFs = new LocalHostFs();
    // Dynamic import: node-pty is only installed on the host, not in containers
    const { NodePtyAdapter } = await import('./adapters/node-pty.adapter.js');
    const nodePty = new NodePtyAdapter(execFn, logger);
    await nodePty.init();
    ptyAdapter = nodePty;
  }

  const config = new JsonConfigAdapter(execFn, hostFs, hostHomedir);
  await config.init();

  const tmux = new TmuxCliAdapter(execFn, logger);
  const git = new GitCliAdapter(execFn, logger);
  const sessionStore = new JsonSessionStore(hostFs, hostHomedir, logger);
  await sessionStore.init();

  const namingService = new SessionNamingService();
  const groupingService = new SessionGroupingService();
  const claudeState = new ClaudeStateAdapter(shellExecFn, hostFs, hostHomedir, logger);

  const enrichClaudeActivity = new EnrichClaudeActivityUseCase(claudeState, logger);

  // Claude usage
  const claudeUsageAdapter = new TmuxClaudeUsageAdapter(execFn, config, logger);
  const getClaudeUsage = new GetClaudeUsageUseCase(claudeUsageAdapter, logger);

  // Repository dashboard services
  const repositoryCache = new RepositoryCache();
  const githubGraphql = new GitHubGraphQLAdapter(execFn, logger);
  const repositoryRefreshScheduler = new RepositoryRefreshScheduler(githubGraphql, repositoryCache, logger);

  // Ticket management
  const agentTokenStore = new JsonAgentTokenStore(hostFs, hostHomedir, logger);
  await agentTokenStore.init();
  const ticketStore = new JsonTicketStore(hostFs, hostHomedir, logger);
  await ticketStore.init();

  const createSession = new CreateSessionUseCase(tmux, sessionStore, namingService, git, config, logger);
  const createWorktreeUC = new CreateWorktreeUseCase(git, logger);
  const detectMerge = new DetectMergeUseCase(ticketStore, logger);
  const createSessionFromTicket = new CreateSessionFromTicketUseCase(
    ticketStore, createSession, createWorktreeUC, git, config, logger,
  );
  const importGitHubIssue = new ImportGitHubIssueUseCase(ticketStore, githubGraphql, logger);

  return {
    logger,
    execFn,
    shellExecFn,
    hostFs,
    hostHomedir,
    config,
    tmux,
    pty: ptyAdapter,
    git,
    sessionStore,
    repositoryCache,
    githubGraphql,
    repositoryRefreshScheduler,
    createSession,
    listSessions: new ListSessionsUseCase(sessionStore, tmux, logger),
    killSession: new KillSessionUseCase(tmux, sessionStore, logger),
    getSessionGroups: new GetSessionGroupsUseCase(sessionStore, tmux, groupingService, logger, enrichClaudeActivity),
    discoverSessions: new DiscoverExistingSessionsUseCase(tmux, sessionStore, namingService, logger, git),
    listRepositories: new ListRepositoriesUseCase(git, config, logger),
    listWorktrees: new ListWorktreesUseCase(git, logger),
    createWorktree: createWorktreeUC,
    getClaudeUsage,
    agentTokenStore,
    ticketStore,
    detectMerge,
    createSessionFromTicket,
    importGitHubIssue,
    ticketBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
  };
}

export type Container = Awaited<ReturnType<typeof createContainer>>;
