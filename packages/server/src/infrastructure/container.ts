import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { SessionNamingService } from '../domain/services/session-naming.js';
import { SessionGroupingService } from '../domain/services/session-grouping.js';
import { RepositoryCache } from '../domain/services/repository-cache.js';
import { RepositoryRefreshScheduler } from '../domain/services/repository-refresh-scheduler.js';
import { RepositoryResolver } from '../domain/services/repository-resolver.js';
import { RepoPathResolver } from '../domain/services/repo-path-resolver.js';
import { BareCloneManager } from '../application/services/bare-clone-manager.js';
import { OverlayManager } from '../application/services/overlay-manager.js';
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
import { ProcessHookEventUseCase } from '../application/use-cases/process-hook-event.js';
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
import { GenerateTicketSummaryUseCase } from '../application/use-cases/generate-ticket-summary.js';
import { GetRelevantSummariesUseCase } from '../application/use-cases/get-relevant-summaries.js';
import { TmuxCliAdapter } from './adapters/tmux-cli.adapter.js';
import { GitCliAdapter } from './adapters/git-cli.adapter.js';
import { GitHubGraphQLAdapter } from './adapters/github-graphql.adapter.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.adapter.js';
import { ClaudeStateAdapter } from './adapters/claude-state.adapter.js';
import { TmuxClaudeUsageAdapter } from './adapters/tmux-claude-usage.adapter.js';
import { DomainEventLogEntity } from '../domain/entities/domain-event-log.entity.js';
import { resolveStorageDriver, createStores } from './adapters/storage-factory.js';
import { CachedSessionStore } from './adapters/cached-session-store.js';
import { CachedTicketStore } from './adapters/cached-ticket-store.js';
import { CachedPersonaStore } from './adapters/cached-persona-store.js';
import { CachedAgentEventStore } from './adapters/cached-agent-event-store.js';
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
    fileStore,
    fileMetaStore,
    ticketGroupStore,
  } = await createStores(driver, { execFn, hostFs, homedir: hostHomedir, logger });

  // Wrap stores with write-through in-memory cache (zero DB queries on 1s tick).
  // Shadow the original variables so all downstream code uses cached versions.
  const sessionStore_ = new CachedSessionStore(sessionStore);
  await sessionStore_.warmUp();
  const ticketStore_ = new CachedTicketStore(ticketStore);
  await ticketStore_.warmUp();
  const personaStore_ = new CachedPersonaStore(personaStore);
  await personaStore_.warmUp();
  const agentEventStore_ = new CachedAgentEventStore(agentEventStore);
  await agentEventStore_.warmUp();

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
      const conn = new SupabaseConnection(supabaseUrl, supabaseKey, supabaseDbUrl, logger);
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
  // groupingService created below after resolver is initialized
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

  // Bare clone infrastructure
  const resolver = new RepoPathResolver(config.get().basePath);
  const groupingService = new SessionGroupingService(resolver, ticketStore_);
  const overlayManager = new OverlayManager(hostFs, resolver, execFn, config, logger);
  const bareCloneManager = new BareCloneManager(git, hostFs, resolver, execFn, logger, overlayManager);

  const createSession = new CreateSessionUseCase(tmux, sessionStore_, namingService, git, config, logger);
  const renameSession = new RenameSessionUseCase(tmux, sessionStore_, namingService, logger);
  const createWorktreeUC = new CreateWorktreeUseCase(git, logger, bareCloneManager, overlayManager, resolver);
  const detectMerge = new DetectMergeUseCase(ticketStore_, logger);
  const createSessionFromTicket = new CreateSessionFromTicketUseCase(
    ticketStore_, createSession, createWorktreeUC, git, config, logger, resolver,
  );
  const importGitHubIssue = new ImportGitHubIssueUseCase(ticketStore_, githubGraphql, logger);
  const backfillPRTicket = new BackfillPRTicketUseCase(ticketStore_, logger);

  // Agent collaboration use cases
  const postComment = new PostCommentUseCase(commentStore, mentionStore, ticketStore_, logger);
  const resolveMention = new ResolveMentionUseCase(mentionStore, ticketStore_, logger);
  const submitDeliverable = new SubmitDeliverableUseCase(deliverableStore, ticketStore_, logger);
  const getRelevantSummaries = new GetRelevantSummariesUseCase(deliverableStore, ticketStore_);
  const getTicketContext = new GetTicketContextUseCase(ticketStore_, commentStore, mentionStore, deliverableStore, getRelevantSummaries, ticketGroupStore);

  // Agent personas use cases
  const createPersona = new CreatePersonaUseCase(personaStore_, logger);
  const updatePersona = new UpdatePersonaUseCase(personaStore_, logger);
  const deletePersona = new DeletePersonaUseCase(personaStore_, logger);

  // Skill CRUD use cases
  const createSkill = new CreateSkillUseCase(skillStore, personaStore_, logger);
  const updateSkill = new UpdateSkillUseCase(skillStore, personaStore_, logger);
  const deleteSkill = new DeleteSkillUseCase(skillStore, logger);

  // Panel CRUD use cases
  const createPanel = new CreatePanelUseCase(panelStore, personaStore_, logger);
  const updatePanel = new UpdatePanelUseCase(panelStore, personaStore_, logger);
  const deletePanel = new DeletePanelUseCase(panelStore, logger);
  const runPanel = new RunPanelUseCase(panelStore, personaStore_, mentionStore, ticketStore_, postComment, submitDeliverable, getTicketContext, createWorktreeUC, agentEventStore_, config, logger);

  const autoReviewWorkflow = new AutoReviewWorkflowUseCase(mentionStore, ticketStore_, config, logger);
  const executeAgent = new ExecuteAgentUseCase(personaStore_, mentionStore, postComment, resolveMention, submitDeliverable, getTicketContext, agentEventStore_, ticketStore_, createWorktreeUC, config, logger, autoReviewWorkflow, skillStore);

  const generateTicketSummary = new GenerateTicketSummaryUseCase(ticketStore_, commentStore, deliverableStore, git, config, logger, resolver);

  const wakeWaitingAgents = new WakeWaitingAgentsUseCase(mentionStore, executeAgent, logger);

  // Domain event bus
  const eventBus = new EventBus();
  const domainEventListener = new DomainEventListener({
    eventBus,
    personaStore: personaStore_,
    skillStore,
    ticketStore: ticketStore_,
    mentionStore,
    commentStore,
    deliverableStore,
    autoReviewWorkflow,
    executeAgent,
    wakeWaitingAgents,
    runPanel,
    generateTicketSummary,
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

  // Wire eventBus + config (avoids circular constructor dep)
  createWorktreeUC.eventBus = eventBus;
  executeAgent.eventBus = eventBus;
  executeAgent.fileMetaStore = fileMetaStore;
  executeAgent.fileStore = fileStore;
  executeAgent.bareCloneManager = bareCloneManager;
  executeAgent.resolver = resolver;
  runPanel.eventBus = eventBus;
  runPanel.fileMetaStore = fileMetaStore;
  runPanel.fileStore = fileStore;
  runPanel.bareCloneManager = bareCloneManager;
  runPanel.resolver = resolver;
  generateTicketSummary.eventBus = eventBus;
  autoReviewWorkflow.eventBus = eventBus;

  // Startup recovery: mark orphaned executions, reset mentions, reload session history
  await executeAgent.init();

  const reconcileWorktree = new ReconcileWorktreeUseCase(createWorktreeUC, resolver, hostFs, bareCloneManager, git, logger);

  const discoverSessions = new DiscoverExistingSessionsUseCase(tmux, sessionStore_, namingService, logger, git, resolver, ticketStore_);
  const getSessionGroups = new GetSessionGroupsUseCase(sessionStore_, tmux, groupingService, logger, enrichClaudeActivity, discoverSessions, ticketStore_, personaStore_, agentEventStore_, reconcileWorktree, hostFs, config);

  // Claude Code hook event processor (POST /api/hook)
  const processHookEvent = new ProcessHookEventUseCase(sessionStore_, eventBus, logger);

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
    sessionStore: sessionStore_,
    repositoryCache,
    githubGraphql,
    repositoryResolver,
    repositoryRefreshScheduler,
    resolver,
    bareCloneManager,
    overlayManager,
    createSession,
    renameSession,
    listSessions: new ListSessionsUseCase(sessionStore_, tmux, logger),
    killSession: new KillSessionUseCase(tmux, sessionStore_, logger),
    getSessionGroups,
    discoverSessions,
    processHookEvent,
    listRepositories: new ListRepositoriesUseCase(git, config, logger, hostFs, resolver),
    listWorktrees: new ListWorktreesUseCase(git, logger, resolver, bareCloneManager),
    createWorktree: createWorktreeUC,
    getClaudeUsage,
    agentTokenStore,
    ticketStore: ticketStore_,
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
    personaStore: personaStore_,
    createPersona,
    updatePersona,
    deletePersona,
    skillStore,
    createSkill,
    updateSkill,
    deleteSkill,
    executeAgent,
    wakeWaitingAgents,
    generateTicketSummary,
    getRelevantSummaries,
    autoReviewWorkflow,
    panelStore,
    createPanel,
    updatePanel,
    deletePanel,
    runPanel,
    agentEventStore: agentEventStore_,
    domainEventLogStore,
    kvStore,
    fileStore,
    fileMetaStore,
    ticketGroupStore,
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
