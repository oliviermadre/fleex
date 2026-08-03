import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { homedir } from 'node:os';

import { DomainEventListener } from '../application/domain-event-listener.js';
import { EventBus } from '../application/event-bus.js';
import {
  isRemoteCacheSync,
  type RemoteCacheSync,
} from '../application/ports/remote-cache-sync.port.js';
import { RemoteDomainEventListener } from '../application/remote-domain-event-listener.js';
import { BareCloneManager } from '../application/services/bare-clone-manager.js';
import { OverlayManager } from '../application/services/overlay-manager.js';
import {
  SdkConcurrencyLimiter,
  DEFAULT_AGENT_MAX_CONCURRENCY,
} from '../application/services/sdk-concurrency-limiter.js';
import { AgentStepExecutor } from '../application/services/step-executors/agent-step-executor.js';
import { HumanGateStepExecutor } from '../application/services/step-executors/human-gate-step-executor.js';
import { PanelStepExecutor } from '../application/services/step-executors/panel-step-executor.js';
import { SkillStepExecutor } from '../application/services/step-executors/skill-step-executor.js';
import { WorkflowOrchestrator } from '../application/services/workflow-orchestrator.js';
import { AutoReviewWorkflowUseCase } from '../application/use-cases/auto-review-workflow.js';
import { BackfillPRTicketUseCase } from '../application/use-cases/backfill-pr-ticket.js';
import { CancelWorkflowRunUseCase } from '../application/use-cases/cancel-workflow-run.js';
import { CreatePanelUseCase } from '../application/use-cases/create-panel.js';
import { CreatePersonaUseCase } from '../application/use-cases/create-persona.js';
import { CreateSessionFromTicketUseCase } from '../application/use-cases/create-session-from-ticket.js';
import { CreateSessionUseCase } from '../application/use-cases/create-session.js';
import { CreateSkillUseCase } from '../application/use-cases/create-skill.js';
import { CreateWorkflowRunUseCase } from '../application/use-cases/create-workflow-run.js';
import { CreateWorktreeUseCase } from '../application/use-cases/create-worktree.js';
import { DeletePanelUseCase } from '../application/use-cases/delete-panel.js';
import { DeletePersonaUseCase } from '../application/use-cases/delete-persona.js';
import { DeleteSkillUseCase } from '../application/use-cases/delete-skill.js';
import { DetectMergeUseCase } from '../application/use-cases/detect-merge.js';
import { DiscoverExistingSessionsUseCase } from '../application/use-cases/discover-existing-sessions.js';
import { EnrichClaudeActivityUseCase } from '../application/use-cases/enrich-claude-activity.js';
import { ExecuteAgentUseCase } from '../application/use-cases/execute-agent.js';
import { GenerateCliSessionSummaryUseCase } from '../application/use-cases/generate-cli-session-summary.js';
import { GenerateTicketSummaryUseCase } from '../application/use-cases/generate-ticket-summary.js';
import { GetClaudeUsageUseCase } from '../application/use-cases/get-claude-usage.js';
import { GetRelevantSummariesUseCase } from '../application/use-cases/get-relevant-summaries.js';
import { GetSessionGroupsUseCase } from '../application/use-cases/get-session-groups.js';
import { GetTicketContextUseCase } from '../application/use-cases/get-ticket-context.js';
import { ImportGitHubIssueUseCase } from '../application/use-cases/import-github-issue.js';
import { ImportSlackMessageUseCase } from '../application/use-cases/import-slack-message.js';
import { IngestCliSessionUseCase } from '../application/use-cases/ingest-cli-session.js';
import { KillSessionUseCase } from '../application/use-cases/kill-session.js';
import { ListRepositoriesUseCase } from '../application/use-cases/list-repositories.js';
import { ListSessionsUseCase } from '../application/use-cases/list-sessions.js';
import { ListWorktreesUseCase } from '../application/use-cases/list-worktrees.js';
import { ManageDeliverableTypesUseCase } from '../application/use-cases/manage-deliverable-types.js';
import { PostCommentUseCase } from '../application/use-cases/post-comment.js';
import { ProcessHookEventUseCase } from '../application/use-cases/process-hook-event.js';
import { ReconcileWorktreeUseCase } from '../application/use-cases/reconcile-worktree.js';
import { RecoverOrphanedWorkflowStepsUseCase } from '../application/use-cases/recover-orphaned-workflow-steps.js';
import { RenameSessionUseCase } from '../application/use-cases/rename-session.js';
import { ResolveHumanGateUseCase } from '../application/use-cases/resolve-human-gate.js';
import { ResolveMentionUseCase } from '../application/use-cases/resolve-mention.js';
import { RetryStepUseCase } from '../application/use-cases/retry-step.js';
import { RunActionUseCase } from '../application/use-cases/run-action.js';
import { RunPanelUseCase } from '../application/use-cases/run-panel.js';
import { RunWorkflowStepUseCase } from '../application/use-cases/run-workflow-step.js';
import { SubmitDeliverableUseCase } from '../application/use-cases/submit-deliverable.js';
import { UpdatePanelUseCase } from '../application/use-cases/update-panel.js';
import { UpdatePersonaUseCase } from '../application/use-cases/update-persona.js';
import { UpdateSkillUseCase } from '../application/use-cases/update-skill.js';
import { WakeWaitingAgentsUseCase } from '../application/use-cases/wake-waiting-agents.js';
import { DomainEventLogEntity } from '../domain/entities/domain-event-log.entity.js';
import { GithubDiscovery } from '../domain/services/github-discovery.js';
import { RepoPathResolver } from '../domain/services/repo-path-resolver.js';
import { RepositoryCache } from '../domain/services/repository-cache.js';
import { RepositoryRefreshScheduler } from '../domain/services/repository-refresh-scheduler.js';
import { RepositoryResolver } from '../domain/services/repository-resolver.js';
import { SessionGroupingService } from '../domain/services/session-grouping.js';
import { SessionNamingService } from '../domain/services/session-naming.js';

import { ApiClaudeUsageAdapter } from './adapters/api-claude-usage.adapter.js';
import { CachedAgentEventStore } from './adapters/cached-agent-event-store.js';
import { CachedPersonaStore } from './adapters/cached-persona-store.js';
import { CachedSessionStore } from './adapters/cached-session-store.js';
import { CachedTicketStore } from './adapters/cached-ticket-store.js';
import { ClaudeSlackImportAdapter } from './adapters/claude-slack-import.adapter.js';
import { ClaudeStateAdapter } from './adapters/claude-state.adapter.js';
import { GitCliAdapter } from './adapters/git-cli.adapter.js';
import { GitHubGraphQLAdapter } from './adapters/github-graphql.adapter.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.adapter.js';
import { resolveStorageDriver, createStores } from './adapters/storage-factory.js';
import { TmuxCliAdapter } from './adapters/tmux-cli.adapter.js';
import { resolveGatewayToken } from './host/gateway-token.js';
import { RemotePtyAdapter } from './host/remote-pty.adapter.js';
import { remoteExec, remoteShellExec, RemoteHostFs } from './host/remote.js';
import { HubClient } from './hub/hub-client.js';
import { HubEventPublisher } from './hub/hub-event-publisher.adapter.js';
import { NullHubEventPublisher } from './hub/null-hub-event-publisher.js';

import type { PgUserStore } from './adapters/pg-user-store.adapter.js';
import type { SupabaseSessionManager } from './adapters/supabase/supabase-session-manager.adapter.js';
import type { SupabaseUserStore } from './adapters/supabase/supabase-user-store.adapter.js';
import type { SessionManager } from './auth/session-manager.js';
import type { HubEventPublisherPort } from '../application/ports/hub-event-publisher.port.js';

const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:3001';

export async function createContainer() {
  const logger = new PinoLoggerAdapter();

  const gatewayUrl = process.env['HOST_GATEWAY_URL'] || DEFAULT_GATEWAY_URL;
  const hostHomedir = process.env['HOST_HOMEDIR'] || homedir();

  // Gateway — always remote, always authenticated. The token is never logged:
  // it is equivalent to a shell on the gateway host.
  const gatewayToken = resolveGatewayToken();
  const execFn = remoteExec(gatewayUrl, gatewayToken);
  const shellExecFn = remoteShellExec(gatewayUrl, gatewayToken);
  const hostFs = new RemoteHostFs(gatewayUrl, gatewayToken);
  const ptyAdapter = new RemotePtyAdapter(gatewayUrl, gatewayToken, logger);

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
    workflowTemplateStore,
    workflowRunStore,
    stepRunStore,
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

  // Caches that can re-sync themselves from shared storage when a sibling
  // instance's write arrives over the hub. Any cache implementing
  // RemoteCacheSync is picked up automatically — see onRemoteEvent below.
  const remoteCaches: RemoteCacheSync[] = [
    sessionStore_,
    ticketStore_,
    personaStore_,
    agentEventStore_,
  ].filter(isRemoteCacheSync);

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
      const { SupabaseUserStore: SbUser } =
        await import('./adapters/supabase/supabase-user-store.adapter.js');
      const { SupabaseSessionManager: SbSess } =
        await import('./adapters/supabase/supabase-session-manager.adapter.js');

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
  const claudeUsageAdapter = new ApiClaudeUsageAdapter(execFn, hostFs, hostHomedir, logger);
  const getClaudeUsage = new GetClaudeUsageUseCase(claudeUsageAdapter, logger);

  // Repository dashboard services
  const repositoryCache = new RepositoryCache();
  const githubGraphql = new GitHubGraphQLAdapter(execFn, logger);
  const repositoryRefreshScheduler = new RepositoryRefreshScheduler(
    githubGraphql,
    repositoryCache,
    logger,
  );
  const repositoryResolver = new RepositoryResolver(execFn, logger);
  const githubDiscovery = new GithubDiscovery(execFn, logger);

  // Bare clone infrastructure
  const resolver = new RepoPathResolver(config.get().basePath);
  const groupingService = new SessionGroupingService(resolver, ticketStore_);
  const overlayManager = new OverlayManager(hostFs, resolver, execFn, config, logger, git);
  const bareCloneManager = new BareCloneManager(
    git,
    hostFs,
    resolver,
    execFn,
    logger,
    overlayManager,
  );

  const createSession = new CreateSessionUseCase(
    tmux,
    sessionStore_,
    namingService,
    git,
    config,
    logger,
  );
  const renameSession = new RenameSessionUseCase(tmux, sessionStore_, namingService, logger);
  const createWorktreeUC = new CreateWorktreeUseCase(
    git,
    logger,
    bareCloneManager,
    overlayManager,
    resolver,
  );
  const detectMerge = new DetectMergeUseCase(ticketStore_, logger);
  const createSessionFromTicket = new CreateSessionFromTicketUseCase(
    ticketStore_,
    createSession,
    createWorktreeUC,
    git,
    config,
    logger,
    resolver,
  );
  const importGitHubIssue = new ImportGitHubIssueUseCase(ticketStore_, githubGraphql, logger);
  const backfillPRTicket = new BackfillPRTicketUseCase(ticketStore_, logger);

  // Agent collaboration use cases
  const postComment = new PostCommentUseCase(commentStore, mentionStore, ticketStore_, logger);
  const resolveMention = new ResolveMentionUseCase(mentionStore, ticketStore_, logger);
  const submitDeliverable = new SubmitDeliverableUseCase(
    deliverableStore,
    ticketStore_,
    config,
    logger,
  );
  // Declared action registry — the only server-side execution path reachable
  // from an HTTP body (see POST /api/actions/:id/run).
  const runAction = new RunActionUseCase(config, ticketStore_, resolver, execFn, logger);
  const getRelevantSummaries = new GetRelevantSummariesUseCase(deliverableStore, ticketStore_);
  const getTicketContext = new GetTicketContextUseCase(
    ticketStore_,
    commentStore,
    mentionStore,
    deliverableStore,
    getRelevantSummaries,
    ticketGroupStore,
  );

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
  // The ONE global limit on concurrent Claude Agent SDK executions, shared by
  // every source (mentions, skills, panels, workflow steps, summaries).
  const sdkLimiter = new SdkConcurrencyLimiter(
    () => config.get().agentMaxConcurrency ?? DEFAULT_AGENT_MAX_CONCURRENCY,
  );

  const runPanel = new RunPanelUseCase(
    panelStore,
    personaStore_,
    mentionStore,
    ticketStore_,
    postComment,
    submitDeliverable,
    getTicketContext,
    createWorktreeUC,
    agentEventStore_,
    config,
    logger,
    sdkLimiter,
  );

  const autoReviewWorkflow = new AutoReviewWorkflowUseCase(
    mentionStore,
    ticketStore_,
    config,
    logger,
  );
  const executeAgent = new ExecuteAgentUseCase(
    personaStore_,
    mentionStore,
    postComment,
    resolveMention,
    submitDeliverable,
    getTicketContext,
    agentEventStore_,
    ticketStore_,
    createWorktreeUC,
    config,
    logger,
    autoReviewWorkflow,
    sdkLimiter,
    skillStore,
  );

  const generateTicketSummary = new GenerateTicketSummaryUseCase(
    ticketStore_,
    commentStore,
    deliverableStore,
    git,
    config,
    logger,
    resolver,
    sdkLimiter,
  );

  // Slack message import: retrieval + synthesis delegated to Claude's native
  // Slack integration via the Agent SDK (gated by the shared sdkLimiter).
  const slackImportAdapter = new ClaudeSlackImportAdapter(sdkLimiter, logger);
  const importSlackMessage = new ImportSlackMessageUseCase(
    ticketStore_,
    slackImportAdapter,
    logger,
  );

  const wakeWaitingAgents = new WakeWaitingAgentsUseCase(mentionStore, executeAgent, logger);

  // Domain event bus
  // Two buses to support multi-instance fan-out without duplicating side-effects:
  //   - eventBus: events emitted by THIS server's use-cases. Carries side-effects
  //     (auto-trigger, auto-review, etc.) AND broadcasts to local WS clients AND
  //     publishes to the hub.
  //   - remoteEventBus: events received FROM the hub (other servers). Carries
  //     broadcasts only — never side-effects, never re-audited, never re-published.
  const eventBus = new EventBus();
  const remoteEventBus = new EventBus();

  // Per-workspace deliverable-type backoffice (CRUD + usage + reassignment).
  const manageDeliverableTypes = new ManageDeliverableTypesUseCase(
    config,
    deliverableStore,
    logger,
    eventBus,
  );

  // Unique per-process server identifier — used to filter our own events on the hub fan-out.
  const serverId = process.env['FLEEX_INSTANCE_ID'] ?? randomUUID();

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
    postComment,
    storageDriver: driver,
  });
  domainEventListener.register();

  // Remote listener — only broadcasts UI updates from events received via the hub.
  // It SHARES the BroadcastRegistrar instance with the local listener so that
  // setTicketBroadcast / setPersonaBroadcast / setSkillBroadcast (called by WS
  // plugins on `domainEventListener`) also affect remote events.
  const remoteDomainEventListener = new RemoteDomainEventListener(
    remoteEventBus,
    domainEventListener.getBroadcastRegistrar(),
  );
  remoteDomainEventListener.register();

  // Hub wiring — active only when FLEEX_EVENT_HUB_URL is set. Works with any
  // storage driver (cloud mode with Supabase/PgSQL, but also local dev with
  // SQLite when two instances share ~/.fleex/fleex.db via main + worktree).
  let hubClient: HubClient | null = null;
  let hubPublisher: HubEventPublisherPort = new NullHubEventPublisher();
  const hubUrl = process.env['FLEEX_EVENT_HUB_URL'];
  if (hubUrl) {
    hubClient = new HubClient({
      url: hubUrl,
      token: process.env['FLEEX_EVENT_HUB_TOKEN'],
      serverId,
      logger,
      onRemoteEvent: async (e) => {
        // Re-sync write-through caches from shared storage BEFORE dispatching,
        // so downstream listeners (UI broadcasts) read the sibling's write
        // rather than our stale cache. Failures must not block the broadcast.
        for (const cache of remoteCaches) {
          try {
            await cache.applyRemoteEvent(e);
          } catch (err) {
            logger.warn('Remote cache sync failed', {
              eventType: e.type,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        remoteEventBus.emit(e);
      },
    });
    hubClient.start();
    hubPublisher = new HubEventPublisher(hubClient);
    logger.info('Event hub configured', { url: hubUrl, serverId });
  } else {
    logger.info('Event hub disabled (FLEEX_EVENT_HUB_URL not set) — running single-instance');
  }

  // Publish every locally-emitted event to the hub (no-op if hub disabled).
  // The publisher itself filters HUB_SHARED_EXCLUDED — session/worktree events
  // reference process-local resources (PTYs, host paths) and have no meaning
  // on other instances.
  eventBus.on('*', (event) => hubPublisher.publish(event));

  // Persist all domain events to the audit trail (originator only — remoteEventBus
  // is NOT audited so each event keeps a single audit row across the cluster).
  // Events listed here are intentionally excluded — they are high-frequency,
  // ephemeral signals (driven by Claude Code hooks) whose source of truth is
  // already the corresponding entity row. Persisting them would also create
  // duplicates per running instance when storage is shared (Supabase/pgsql).
  const AUDIT_EXCLUDED_EVENTS = new Set<string>(['session.hookStatusChanged']);
  const instanceId =
    process.env['FLEEX_INSTANCE_ID'] ?? `${hostname()}:${process.env['PORT'] ?? '3000'}`;
  eventBus.on('*', (event) => {
    if (AUDIT_EXCLUDED_EVENTS.has(event.type)) return;
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
  runAction.eventBus = eventBus;
  executeAgent.eventBus = eventBus;
  // Re-drain the per-(agent,ticket) queue when a thread frees its lane via an
  // external resolve/delete (e.g. manual UI resolve of a waiting_for_info mention).
  executeAgent.subscribeToBus(eventBus);
  executeAgent.fileMetaStore = fileMetaStore;
  executeAgent.fileStore = fileStore;
  executeAgent.bareCloneManager = bareCloneManager;
  executeAgent.resolver = resolver;
  runPanel.eventBus = eventBus;
  runPanel.fileMetaStore = fileMetaStore;
  runPanel.fileStore = fileStore;
  runPanel.bareCloneManager = bareCloneManager;
  runPanel.resolver = resolver;
  // Makes each panel-spawned SDK session (members + orchestrator) abortable via
  // the Terminate endpoint, just like persona/skill/workflow executions.
  runPanel.executionRegistry = executeAgent;
  generateTicketSummary.eventBus = eventBus;
  autoReviewWorkflow.eventBus = eventBus;
  // Slack import synthesizes in the background and patches the ticket via ticket.updated.
  importSlackMessage.eventBus = eventBus;

  // ── Phase B: Workflow orchestration ──────────────────────────────────────
  // Stores are non-null for sqlite and supabase adapters, null for json/pgsql.
  let createWorkflowRun: CreateWorkflowRunUseCase | null = null;
  let resolveHumanGate: ResolveHumanGateUseCase | null = null;
  let retryStep: RetryStepUseCase | null = null;
  let cancelWorkflowRun: CancelWorkflowRunUseCase | null = null;
  let workflowOrchestrator: WorkflowOrchestrator | null = null;

  if (workflowTemplateStore && workflowRunStore && stepRunStore) {
    // Step executors
    const agentStepExecutor = new AgentStepExecutor(executeAgent);
    const skillStepExecutor = new SkillStepExecutor(executeAgent, skillStore);
    const panelStepExecutor = new PanelStepExecutor(runPanel);
    const humanGateStepExecutor = new HumanGateStepExecutor(postComment);

    // RunWorkflowStep — orchestrator dep resolved below (circular dep pattern)
    const runWorkflowStep = new RunWorkflowStepUseCase({
      runStore: workflowRunStore,
      stepRunStore,
      orchestrator: null as never, // wired below after WorkflowOrchestrator is created
      eventBus,
      executors: {
        agent: agentStepExecutor,
        skill: skillStepExecutor,
        panel: panelStepExecutor,
        human_gate: humanGateStepExecutor,
      },
      submitDeliverable,
      postComment,
      agentEventStore: agentEventStore_,
    });

    workflowOrchestrator = new WorkflowOrchestrator(runWorkflowStep, logger);

    // Resolve circular dep: runWorkflowStep.deps.orchestrator = workflowOrchestrator
    (
      runWorkflowStep as unknown as { deps: { orchestrator: WorkflowOrchestrator } }
    ).deps.orchestrator = workflowOrchestrator;

    createWorkflowRun = new CreateWorkflowRunUseCase(
      workflowTemplateStore,
      workflowRunStore,
      workflowOrchestrator,
      eventBus,
      postComment,
    );
    resolveHumanGate = new ResolveHumanGateUseCase(
      workflowRunStore,
      stepRunStore,
      workflowOrchestrator,
      eventBus,
      postComment,
      logger,
    );
    retryStep = new RetryStepUseCase(
      workflowRunStore,
      stepRunStore,
      workflowOrchestrator,
      executeAgent,
    );
    cancelWorkflowRun = new CancelWorkflowRunUseCase(
      workflowRunStore,
      stepRunStore,
      executeAgent,
      eventBus,
    );

    logger.info('Workflow orchestration wired', { driver });
  } else {
    logger.info('Workflow orchestration not available for this storage driver', { driver });
  }

  // Wire workflow deps into the domain event listener (initialized after Phase B)
  domainEventListener.setWorkflowDeps({ workflowTemplateStore, createWorkflowRun });

  // Startup recovery: mark orphaned executions, reset mentions, reload session history
  await executeAgent.init();

  // Startup recovery (workflows): mark step_runs that were running when the
  // server died as failed, and fail their parent runs, so the UI shows them
  // with a retry affordance instead of forever spinning on a dead process.
  if (workflowRunStore && stepRunStore) {
    const recoverOrphans = new RecoverOrphanedWorkflowStepsUseCase(
      workflowRunStore,
      stepRunStore,
      eventBus,
      logger,
    );
    await recoverOrphans.execute();
  }

  const reconcileWorktree = new ReconcileWorktreeUseCase(
    createWorktreeUC,
    resolver,
    hostFs,
    bareCloneManager,
    git,
    logger,
  );

  const discoverSessions = new DiscoverExistingSessionsUseCase(
    tmux,
    sessionStore_,
    namingService,
    logger,
    git,
    resolver,
    ticketStore_,
  );
  const getSessionGroups = new GetSessionGroupsUseCase(
    sessionStore_,
    tmux,
    groupingService,
    logger,
    enrichClaudeActivity,
    discoverSessions,
    ticketStore_,
    personaStore_,
    agentEventStore_,
    reconcileWorktree,
    hostFs,
    config,
    namingService,
  );

  // Claude Code hook event processor (POST /api/hook). On SessionEnd it also
  // ingests finished manual CLI sessions (source='cli') for cost tracking, then
  // persists their decision trail as a `cli-session-summary` deliverable.
  const ingestCliSession = new IngestCliSessionUseCase(ticketStore_, agentEventStore_, logger);
  const generateCliSessionSummary = new GenerateCliSessionSummaryUseCase(
    deliverableStore,
    logger,
    sdkLimiter,
  );
  generateCliSessionSummary.eventBus = eventBus;
  const processHookEvent = new ProcessHookEventUseCase(
    sessionStore_,
    eventBus,
    logger,
    ingestCliSession,
    generateCliSessionSummary,
  );

  return {
    logger,
    storageDriver: driver,
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
    githubDiscovery,
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
    importSlackMessage,
    backfillPRTicket,
    commentStore,
    mentionStore,
    deliverableStore,
    postComment,
    resolveMention,
    submitDeliverable,
    runAction,
    manageDeliverableTypes,
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
    workflowTemplateStore,
    workflowRunStore,
    stepRunStore,
    workflowOrchestrator,
    createWorkflowRun,
    resolveHumanGate,
    retryStep,
    cancelWorkflowRun,
    eventBus,
    remoteEventBus,
    domainEventListener,
    remoteDomainEventListener,
    hubClient,
    serverId,
    ticketBroadcast: ((_type: string, _data: unknown) => {}) as (
      type: string,
      data: unknown,
    ) => void,
    agentBroadcast: ((_type: string, _data: unknown) => {}) as (
      type: string,
      data: unknown,
    ) => void,
    personaBroadcast: ((_type: string, _data: unknown) => {}) as (
      type: string,
      data: unknown,
    ) => void,
    skillBroadcast: ((_type: string, _data: unknown) => {}) as (
      type: string,
      data: unknown,
    ) => void,
    agentEventBroadcast: ((_msg: unknown) => {}) as (msg: unknown) => void,
    jsonlFileWatcher: undefined,
  };
}

export type Container = Awaited<ReturnType<typeof createContainer>>;
