import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { SessionNamingService } from '../domain/services/session-naming.js';
import { SessionGroupingService } from '../domain/services/session-grouping.js';
import { RepositoryCache } from '../domain/services/repository-cache.js';
import { RepositoryRefreshScheduler } from '../domain/services/repository-refresh-scheduler.js';
import { RepositoryResolver } from '../domain/services/repository-resolver.js';
import { EventBus } from '../application/event-bus.js';
import { DomainEventListener } from '../application/domain-event-listener.js';
import { CreateSessionUseCase } from '../application/use-cases/create-session.js';
import { ListSessionsUseCase } from '../application/use-cases/list-sessions.js';
import { KillSessionUseCase } from '../application/use-cases/kill-session.js';
import { GetSessionGroupsUseCase } from '../application/use-cases/get-session-groups.js';
import { DiscoverExistingSessionsUseCase } from '../application/use-cases/discover-existing-sessions.js';
import { ListRepositoriesUseCase } from '../application/use-cases/list-repositories.js';
import { ListWorktreesUseCase } from '../application/use-cases/list-worktrees.js';
import { CreateWorktreeUseCase } from '../application/use-cases/create-worktree.js';
import { ReconcileWorktreeUseCase } from '../application/use-cases/reconcile-worktree.js';
import { EnrichClaudeActivityUseCase } from '../application/use-cases/enrich-claude-activity.js';
import { GetClaudeUsageUseCase } from '../application/use-cases/get-claude-usage.js';
import type { PgUserStore } from './adapters/pg-user-store.adapter.js';
import type { SessionManager } from './auth/session-manager.js';
import type { SupabaseUserStore } from './adapters/supabase/supabase-user-store.adapter.js';
import type { SupabaseSessionManager } from './adapters/supabase/supabase-session-manager.adapter.js';
import { CreateSessionFromTicketUseCase } from '../application/use-cases/create-session-from-ticket.js';
import { DetectMergeUseCase } from '../application/use-cases/detect-merge.js';
import { RenameSessionUseCase } from '../application/use-cases/rename-session.js';
import { ImportGitHubIssueUseCase } from '../application/use-cases/import-github-issue.js';
import { BackfillPRTicketUseCase } from '../application/use-cases/backfill-pr-ticket.js';
import { PostCommentUseCase } from '../application/use-cases/post-comment.js';
import { ResolveMentionUseCase } from '../application/use-cases/resolve-mention.js';
import { SubmitDeliverableUseCase } from '../application/use-cases/submit-deliverable.js';
import { GetTicketContextUseCase } from '../application/use-cases/get-ticket-context.js';
import { CreatePersonaUseCase } from '../application/use-cases/create-persona.js';
import { UpdatePersonaUseCase } from '../application/use-cases/update-persona.js';
import { DeletePersonaUseCase } from '../application/use-cases/delete-persona.js';
import { CreateSkillUseCase } from '../application/use-cases/create-skill.js';
import { UpdateSkillUseCase } from '../application/use-cases/update-skill.js';
import { DeleteSkillUseCase } from '../application/use-cases/delete-skill.js';
import { ExecuteAgentUseCase } from '../application/use-cases/execute-agent.js';
import { WakeWaitingAgentsUseCase } from '../application/use-cases/wake-waiting-agents.js';
import { AutoReviewWorkflowUseCase } from '../application/use-cases/auto-review-workflow.js';
import { CreatePanelUseCase } from '../application/use-cases/create-panel.js';
import { UpdatePanelUseCase } from '../application/use-cases/update-panel.js';
import { DeletePanelUseCase } from '../application/use-cases/delete-panel.js';
import { RunPanelUseCase } from '../application/use-cases/run-panel.js';
import { TmuxCliAdapter } from './adapters/tmux-cli.adapter.js';
import { GitCliAdapter } from './adapters/git-cli.adapter.js';
import { GitHubGraphQLAdapter } from './adapters/github-graphql.adapter.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.adapter.js';
import { ClaudeStateAdapter } from './adapters/claude-state.adapter.js';
import { TmuxClaudeUsageAdapter } from './adapters/tmux-claude-usage.adapter.js';
import { DomainEventLogEntity } from '../domain/entities/domain-event-log.entity.js';
import { resolveStorageDriver, createStores } from './adapters/storage-factory.js';
import { remoteExec, remoteShellExec, RemoteHostFs } from './host/remote.js';
import { RemotePtyAdapter } from './host/remote-pty.adapter.js';

const DEFAULT_GATEWAY_URL = 'http://localhost:3001';

export async function createContainer() {
  const logger = new PinoLoggerAdapter();

  const gatewayUrl = process.env['HOST_GATEWAY_URL'] || DEFAULT_GATEWAY_URL;
  const hostHomedir = process.env['HOST_HOMEDIR'] || homedir();

  // Gateway — always remote
  const execFn = remoteExec(gatewayUrl);
  const shellExecFn = remoteShellExec(gatewayUrl);
  const hostFs = new RemoteHostFs(gatewayUrl);
  const ptyAdapter = new RemotePtyAdapter(gatewayUrl, logger);

  logger.info('Gateway configured', { gatewayUrl });

  // Storage driver selection via FLEEX_STORAGE_DRIVER env var
  // Config is now created by the storage factory alongside all other stores.
  const driver = resolveStorageDriver();
  logger.info('Storage driver selected', { driver });

  const {
    configStore: config,
    sessionStore,
    ticketStore,
    agentTokenStore,
    commentStore,
    mentionStore,
    deliverableStore,
    personaStore,
    agentEventStore,
    domainEventLogStore,
    skillStore,
    panelStore,
    kvStore,
  } = await createStores(driver, { execFn, hostFs, homedir: hostHomedir, logger });

  const tmux = new TmuxCliAdapter(execFn, logger);
  const git = new GitCliAdapter(execFn, logger);

  // Auth stores (database-backed features)
  let userStore: PgUserStore | SupabaseUserStore | null = null;
  let sessionManager: SessionManager | SupabaseSessionManager | null = null;

  if (driver === 'supabase') {
    const supabaseUrl = process.env['FLEEX_SUPABASE_URL'];
    const supabaseKey = process.env['FLEEX_SUPABASE_KEY'];
    if (supabaseUrl && supabaseKey) {
      const { SupabaseConnection } = await import('./adapters/supabase/connection.js');
      const { SupabaseUserStore: SbUser } = await import('./adapters/supabase/supabase-user-store.adapter.js');
      const { SupabaseSessionManager: SbSess } = await import('./adapters/supabase/supabase-session-manager.adapter.js');

      const supabaseDbUrl = process.env['FLEEX_SUPABASE_DB_URL'];
      const conn = new SupabaseConnection(supabaseUrl, supabaseKey, supabaseDbUrl);
      await conn.init();

      userStore = new SbUser(conn);
      sessionManager = new SbSess(conn);
      logger.info('Supabase auth stores initialized');
    }
  } else if (driver === 'pgsql') {
    const databaseUrl = process.env['DATABASE_URL'] || process.env['FLEEX_PGSQL_URL'];
    if (databaseUrl) {
      const { createDbPool } = await import('./database/db.js');
      const { PgUserStore: PgUser } = await import('./adapters/pg-user-store.adapter.js');
      const { SessionManager: SessMgr } = await import('./auth/session-manager.js');

      const db = await createDbPool(logger);
      userStore = new PgUser(db, logger);
      sessionManager = new SessMgr(db);
      logger.info('PostgreSQL auth stores initialized');
    }
  }

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
  const repositoryResolver = new RepositoryResolver(execFn, logger);

  const createSession = new CreateSessionUseCase(tmux, sessionStore, namingService, git, config, logger);
  const renameSession = new RenameSessionUseCase(tmux, sessionStore, namingService, logger);
  const createWorktreeUC = new CreateWorktreeUseCase(git, logger);
  const detectMerge = new DetectMergeUseCase(ticketStore, logger);
  const createSessionFromTicket = new CreateSessionFromTicketUseCase(
    ticketStore, createSession, createWorktreeUC, git, config, logger,
  );
  const importGitHubIssue = new ImportGitHubIssueUseCase(ticketStore, githubGraphql, logger);
  const backfillPRTicket = new BackfillPRTicketUseCase(ticketStore, logger);

  // Agent collaboration use cases
  const postComment = new PostCommentUseCase(commentStore, mentionStore, ticketStore, logger);
  const resolveMention = new ResolveMentionUseCase(mentionStore, ticketStore, logger);
  const submitDeliverable = new SubmitDeliverableUseCase(deliverableStore, ticketStore, logger);
  const getTicketContext = new GetTicketContextUseCase(ticketStore, commentStore, mentionStore, deliverableStore);

  // Agent personas use cases
  const createPersona = new CreatePersonaUseCase(personaStore, logger);
  const updatePersona = new UpdatePersonaUseCase(personaStore, logger);
  const deletePersona = new DeletePersonaUseCase(personaStore, logger);

  // Skill CRUD use cases
  const createSkill = new CreateSkillUseCase(skillStore, personaStore, logger);
  const updateSkill = new UpdateSkillUseCase(skillStore, personaStore, logger);
  const deleteSkill = new DeleteSkillUseCase(skillStore, logger);

  // Panel CRUD use cases
  const createPanel = new CreatePanelUseCase(panelStore, personaStore, logger);
  const updatePanel = new UpdatePanelUseCase(panelStore, personaStore, logger);
  const deletePanel = new DeletePanelUseCase(panelStore, logger);
  const runPanel = new RunPanelUseCase(panelStore, personaStore, mentionStore, ticketStore, postComment, submitDeliverable, getTicketContext, logger);

  const autoReviewWorkflow = new AutoReviewWorkflowUseCase(mentionStore, ticketStore, config, logger);
  const executeAgent = new ExecuteAgentUseCase(personaStore, mentionStore, postComment, resolveMention, submitDeliverable, getTicketContext, agentEventStore, ticketStore, createWorktreeUC, config, logger, autoReviewWorkflow, skillStore);

  const wakeWaitingAgents = new WakeWaitingAgentsUseCase(mentionStore, executeAgent, logger);

  // Domain event bus
  const eventBus = new EventBus();
  const domainEventListener = new DomainEventListener({
    eventBus,
    personaStore,
    skillStore,
    ticketStore,
    mentionStore,
    commentStore,
    deliverableStore,
    autoReviewWorkflow,
    executeAgent,
    wakeWaitingAgents,
    runPanel,
    logger,
  });
  domainEventListener.register();

  // Persist all domain events to the audit trail
  const instanceId = process.env['FLEEX_INSTANCE_ID'] ?? `${hostname()}:${process.env['PORT'] ?? '3000'}`;
  eventBus.on('*', (event) => {
    const entry = DomainEventLogEntity.create({
      id: randomUUID(),
      eventType: event.type,
      payload: { ...event } as Record<string, unknown>,
      instanceId,
      occurredAt: event.occurredAt,
    });
    return domainEventLogStore.save(entry);
  });

  // Wire eventBus (avoids circular constructor dep)
  createWorktreeUC.eventBus = eventBus;
  executeAgent.eventBus = eventBus;
  runPanel.eventBus = eventBus;

  // Startup recovery: mark orphaned executions, reset mentions, reload session history
  await executeAgent.init();

  const reconcileWorktree = new ReconcileWorktreeUseCase(createWorktreeUC, config, hostFs, git, logger);

  const discoverSessions = new DiscoverExistingSessionsUseCase(tmux, sessionStore, namingService, logger, git);
  const getSessionGroups = new GetSessionGroupsUseCase(sessionStore, tmux, groupingService, logger, enrichClaudeActivity, discoverSessions, ticketStore, personaStore, agentEventStore, reconcileWorktree, hostFs, config);

  return {
    logger,
    gatewayUrl,
    execFn,
    shellExecFn,
    hostFs,
    hostHomedir,
    config,
    tmux,
    pty: ptyAdapter,
    git,
    userStore,
    sessionManager,
    sessionStore,
    repositoryCache,
    githubGraphql,
    repositoryResolver,
    repositoryRefreshScheduler,
    createSession,
    renameSession,
    listSessions: new ListSessionsUseCase(sessionStore, tmux, logger),
    killSession: new KillSessionUseCase(tmux, sessionStore, logger),
    getSessionGroups,
    discoverSessions,
    listRepositories: new ListRepositoriesUseCase(git, config, logger),
    listWorktrees: new ListWorktreesUseCase(git, logger),
    createWorktree: createWorktreeUC,
    getClaudeUsage,
    agentTokenStore,
    ticketStore,
    detectMerge,
    createSessionFromTicket,
    importGitHubIssue,
    backfillPRTicket,
    commentStore,
    mentionStore,
    deliverableStore,
    postComment,
    resolveMention,
    submitDeliverable,
    getTicketContext,
    personaStore,
    createPersona,
    updatePersona,
    deletePersona,
    skillStore,
    createSkill,
    updateSkill,
    deleteSkill,
    executeAgent,
    wakeWaitingAgents,
    autoReviewWorkflow,
    panelStore,
    createPanel,
    updatePanel,
    deletePanel,
    runPanel,
    agentEventStore,
    domainEventLogStore,
    kvStore,
    eventBus,
    domainEventListener,
    ticketBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    agentBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    personaBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    skillBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    agentEventBroadcast: ((_msg: unknown) => {}) as (msg: unknown) => void,
    jsonlFileWatcher: undefined,
  };
}

export type Container = Awaited<ReturnType<typeof createContainer>>;
