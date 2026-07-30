import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { SessionNamingService } from '../domain/services/session-naming.js';
import { SessionGroupingService } from '../domain/services/session-grouping.js';
import { RepositoryCache } from '../domain/services/repository-cache.js';
import { RepositoryRefreshScheduler } from '../domain/services/repository-refresh-scheduler.js';
import { RepositoryResolver } from '../domain/services/repository-resolver.js';
import { GithubDiscovery } from '../domain/services/github-discovery.js';
import { RepoPathResolver } from '../domain/services/repo-path-resolver.js';
import { BareCloneManager } from '../application/services/bare-clone-manager.js';
import { SdkConcurrencyLimiter, DEFAULT_AGENT_MAX_CONCURRENCY } from '../application/services/sdk-concurrency-limiter.js';
import { OverlayManager } from '../application/services/overlay-manager.js';
import { resolveInstanceIdentity } from '../application/services/instance-identity.js';
import { EventBus } from '../application/event-bus.js';
import { DomainEventListener } from '../application/domain-event-listener.js';
import { RemoteDomainEventListener } from '../application/remote-domain-event-listener.js';
import { HubClient } from './hub/hub-client.js';
import { AgentBackfillRegistry } from './hub/agent-backfill-registry.js';
import { HubEventPublisher } from './hub/hub-event-publisher.adapter.js';
import { NullHubEventPublisher } from './hub/null-hub-event-publisher.js';
import type { HubEventPublisherPort } from '../application/ports/hub-event-publisher.port.js';
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
import { IngestCliSessionUseCase } from '../application/use-cases/ingest-cli-session.js';
import type { PgUserStore } from './adapters/pg-user-store.adapter.js';
import type { SessionManager } from './auth/session-manager.js';
import type { SupabaseUserStore } from './adapters/supabase/supabase-user-store.adapter.js';
import type { SupabaseSessionManager } from './adapters/supabase/supabase-session-manager.adapter.js';
import { CreateSessionFromTicketUseCase } from '../application/use-cases/create-session-from-ticket.js';
import { DetectMergeUseCase } from '../application/use-cases/detect-merge.js';
import { RenameSessionUseCase } from '../application/use-cases/rename-session.js';
import { ImportGitHubIssueUseCase } from '../application/use-cases/import-github-issue.js';
import { ImportSlackMessageUseCase } from '../application/use-cases/import-slack-message.js';
import { BackfillPRTicketUseCase } from '../application/use-cases/backfill-pr-ticket.js';
import { PostCommentUseCase } from '../application/use-cases/post-comment.js';
import { ResolveMentionUseCase } from '../application/use-cases/resolve-mention.js';
import { SubmitDeliverableUseCase } from '../application/use-cases/submit-deliverable.js';
import { ManageDeliverableTypesUseCase } from '../application/use-cases/manage-deliverable-types.js';
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
import { GenerateCliSessionSummaryUseCase } from '../application/use-cases/generate-cli-session-summary.js';
import { AgentStepExecutor } from '../application/services/step-executors/agent-step-executor.js';
import { SkillStepExecutor } from '../application/services/step-executors/skill-step-executor.js';
import { PanelStepExecutor } from '../application/services/step-executors/panel-step-executor.js';
import { HumanGateStepExecutor } from '../application/services/step-executors/human-gate-step-executor.js';
import { WorkflowOrchestrator } from '../application/services/workflow-orchestrator.js';
import { RunWorkflowStepUseCase } from '../application/use-cases/run-workflow-step.js';
import { CreateWorkflowRunUseCase } from '../application/use-cases/create-workflow-run.js';
import { ResolveHumanGateUseCase } from '../application/use-cases/resolve-human-gate.js';
import { RetryStepUseCase } from '../application/use-cases/retry-step.js';
import { CancelWorkflowRunUseCase } from '../application/use-cases/cancel-workflow-run.js';
import { RecoverOrphanedWorkflowStepsUseCase } from '../application/use-cases/recover-orphaned-workflow-steps.js';
import { GetRelevantSummariesUseCase } from '../application/use-cases/get-relevant-summaries.js';
import { TmuxCliAdapter } from './adapters/tmux-cli.adapter.js';
import { GitCliAdapter } from './adapters/git-cli.adapter.js';
import { GitHubGraphQLAdapter } from './adapters/github-graphql.adapter.js';
import { ClaudeSlackImportAdapter } from './adapters/claude-slack-import.adapter.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.adapter.js';
import { ClaudeStateAdapter } from './adapters/claude-state.adapter.js';
import { ApiClaudeUsageAdapter } from './adapters/api-claude-usage.adapter.js';
import { DomainEventLogEntity } from '../domain/entities/domain-event-log.entity.js';
import { resolveStorageDriver, createStores } from './adapters/storage-factory.js';
import { CachedSessionStore } from './adapters/cached-session-store.js';
import { CachedTicketStore } from './adapters/cached-ticket-store.js';
import { CachedPersonaStore } from './adapters/cached-persona-store.js';
import { CachedAgentEventStore } from './adapters/cached-agent-event-store.js';
import { isRemoteCacheSync, type RemoteCacheSync } from '../application/ports/remote-cache-sync.port.js';
import type { AgentEventListener, AgentEventOrigin } from '../application/ports/agent-event-relay.port.js';
import { AgentEventEntity } from '../domain/entities/agent-event.entity.js';
import type { AgentEvent } from '@fleex/shared';
import { remoteExec, remoteShellExec, RemoteHostFs } from './host/remote.js';
import { RemotePtyAdapter } from './host/remote-pty.adapter.js';

const DEFAULT_GATEWAY_URL = 'http://localhost:3001';

/** Rehydrate a relayed agent event so it can be mirrored to local storage. */
function agentEventFromDTO(dto: AgentEvent): AgentEventEntity {
  return new AgentEventEntity(
    dto.id,
    dto.executionId,
    dto.eventType,
    dto.data,
    dto.sequence,
    new Date(dto.createdAt),
  );
}

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
  const instance = resolveInstanceIdentity();
  const agentEventStore_ = new CachedAgentEventStore(agentEventStore, instance);
  await agentEventStore_.warmUp();

  // Caches that can re-sync themselves from shared storage when a sibling
  // instance's write arrives over the hub. Any cache implementing
  // RemoteCacheSync is picked up automatically — see onRemoteEvent below.
  const remoteCaches: RemoteCacheSync[] = [sessionStore_, ticketStore_, personaStore_, agentEventStore_].filter(
    isRemoteCacheSync,
  );

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
  const claudeUsageAdapter = new ApiClaudeUsageAdapter(execFn, hostFs, hostHomedir, logger);
  const getClaudeUsage = new GetClaudeUsageUseCase(claudeUsageAdapter, logger);

  // Repository dashboard services
  const repositoryCache = new RepositoryCache();
  const githubGraphql = new GitHubGraphQLAdapter(execFn, logger);
  const repositoryRefreshScheduler = new RepositoryRefreshScheduler(githubGraphql, repositoryCache, logger);
  const repositoryResolver = new RepositoryResolver(execFn, logger);
  const githubDiscovery = new GithubDiscovery(execFn, logger);

  // Bare clone infrastructure
  const resolver = new RepoPathResolver(config.get().basePath);
  const groupingService = new SessionGroupingService(resolver, ticketStore_);
  const overlayManager = new OverlayManager(hostFs, resolver, execFn, config, logger, git);
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
  const submitDeliverable = new SubmitDeliverableUseCase(deliverableStore, ticketStore_, config, logger);
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
  // The ONE global limit on concurrent Claude Agent SDK executions, shared by
  // every source (mentions, skills, panels, workflow steps, summaries).
  const sdkLimiter = new SdkConcurrencyLimiter(() => config.get().agentMaxConcurrency ?? DEFAULT_AGENT_MAX_CONCURRENCY);

  const runPanel = new RunPanelUseCase(panelStore, personaStore_, mentionStore, ticketStore_, postComment, submitDeliverable, getTicketContext, createWorktreeUC, agentEventStore_, config, logger, sdkLimiter);

  const autoReviewWorkflow = new AutoReviewWorkflowUseCase(mentionStore, ticketStore_, config, logger);
  const executeAgent = new ExecuteAgentUseCase(personaStore_, mentionStore, postComment, resolveMention, submitDeliverable, getTicketContext, agentEventStore_, ticketStore_, createWorktreeUC, config, logger, autoReviewWorkflow, sdkLimiter, skillStore);

  const generateTicketSummary = new GenerateTicketSummaryUseCase(ticketStore_, commentStore, deliverableStore, git, config, logger, resolver, sdkLimiter);

  // Slack message import: retrieval + synthesis delegated to Claude's native
  // Slack integration via the Agent SDK (gated by the shared sdkLimiter).
  const slackImportAdapter = new ClaudeSlackImportAdapter(sdkLimiter, logger);
  const importSlackMessage = new ImportSlackMessageUseCase(ticketStore_, slackImportAdapter, logger);

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
  const manageDeliverableTypes = new ManageDeliverableTypesUseCase(config, deliverableStore, logger, eventBus);

  // Per-process hub identity: only ever answers "is this message mine?", so a
  // fresh UUID per start is fine and deliberate. Distinct from `instance.id`,
  // which must stay stable across restarts because it is persisted on execution
  // rows and audit entries — see `resolveInstanceIdentity`.
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

  // ── Agent event fan-out ──
  // Agent events (the SDK stream of a run) do NOT travel on the domain event bus:
  // they'd be re-audited and would re-trigger side-effects. They get their own
  // fan-out, fed by local runs and by the hub, and consumed by the WS layer and
  // the hub publisher.
  const agentEventListeners: AgentEventListener[] = [];
  const emitAgentEvent = (event: AgentEvent, origin?: AgentEventOrigin): void => {
    for (const listener of agentEventListeners) {
      try {
        listener(event, origin);
      } catch (err) {
        logger.warn('Agent event listener threw', {
          executionId: event.executionId,
          eventType: event.eventType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  executeAgent.onEvent = (e) => emitAgentEvent(e.toDTO());
  runPanel.onEvent = executeAgent.onEvent;

  // Executions a local browser is actively watching. Gates two things: which
  // streams we ask siblings for, and which relayed events we bother writing to
  // disk. A run merely *seen* as running must cost neither bandwidth nor I/O.
  let localStreamDemand = new Set<string>();
  const agentBackfills = new AgentBackfillRegistry();

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
      instance,
      relayAgentEvents: process.env['FLEEX_HUB_RELAY_AGENT_EVENTS'] !== '0',
      onRemoteAgentEvent: async (msg) => {
        const { event } = msg;

        // The execution row itself lives in shared storage, but our write-through
        // cache never saw the sibling's write — re-read it before anything reads
        // "is this running?" from the cache (Kanban pill, Execution Log).
        let personaId: string | undefined;
        if (event.eventType === 'execution_start' || event.eventType === 'execution_end') {
          try {
            await agentEventStore_.refreshExecution(event.executionId);
            personaId = (await agentEventStore_.getExecutionById(event.executionId))?.personaId;
          } catch (err) {
            logger.warn('Remote execution refresh failed', {
              executionId: event.executionId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Persist only what someone here is watching (or explicitly asked for via
        // backfill), so the local event-history endpoint can replay it.
        if (msg.targetServerId != null || localStreamDemand.has(event.executionId)) {
          try {
            await agentEventStore_.mirrorRemoteEvents([agentEventFromDTO(event)]);
          } catch (err) {
            logger.warn('Remote agent event mirroring failed', {
              executionId: event.executionId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        emitAgentEvent(event, {
          instanceId: msg.originatorInstanceId,
          instanceLabel: msg.originatorInstanceLabel,
          ...(msg.truncated ? { truncated: true } : {}),
          ...(personaId ? { personaId } : {}),
        });
      },
      onAgentBackfillRequest: async (msg) => {
        // Answer only for runs we own: another instance may hold a partial mirror
        // of the same execution, and replying from it would serve a truncated log
        // as if it were complete.
        try {
          const exec = await agentEventStore_.getExecutionById(msg.executionId);
          if (!exec || exec.instanceId !== instance.id) return;
          const events = await agentEventStore_.getEventsByExecution(msg.executionId);
          hubClient?.respondAgentBackfill(msg, events.map((e) => e.toDTO()));
        } catch (err) {
          logger.warn('Agent backfill response failed', {
            executionId: msg.executionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      onAgentBackfillEnd: (msg) => {
        agentBackfills.settle(msg);
      },
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

    // Relay locally-produced agent events only. Re-publishing a relayed one would
    // ping-pong it: the hub's originator filter protects the sender, not a third
    // instance forwarding someone else's event under its own id.
    const client = hubClient;
    agentEventListeners.push((event, origin) => {
      if (origin) return;
      client.publishAgentEvent(event);
    });

    logger.info('Event hub configured', {
      url: hubUrl,
      serverId,
      instanceId: instance.id,
      relayAgentEvents: process.env['FLEEX_HUB_RELAY_AGENT_EVENTS'] !== '0',
    });
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
  const AUDIT_EXCLUDED_EVENTS = new Set<string>([
    'session.hookStatusChanged',
  ]);
  const instanceId = instance.id;
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
    (runWorkflowStep as unknown as { deps: { orchestrator: WorkflowOrchestrator } }).deps.orchestrator = workflowOrchestrator;

    createWorkflowRun = new CreateWorkflowRunUseCase(workflowTemplateStore, workflowRunStore, workflowOrchestrator, eventBus, postComment);
    resolveHumanGate = new ResolveHumanGateUseCase(workflowRunStore, stepRunStore, workflowOrchestrator, eventBus, postComment, logger);
    retryStep = new RetryStepUseCase(workflowRunStore, stepRunStore, workflowOrchestrator, executeAgent);
    cancelWorkflowRun = new CancelWorkflowRunUseCase(workflowRunStore, stepRunStore, executeAgent, eventBus);

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
    const recoverOrphans = new RecoverOrphanedWorkflowStepsUseCase(workflowRunStore, stepRunStore, eventBus, logger);
    await recoverOrphans.execute();
  }

  const reconcileWorktree = new ReconcileWorktreeUseCase(createWorktreeUC, resolver, hostFs, bareCloneManager, git, logger);

  const discoverSessions = new DiscoverExistingSessionsUseCase(tmux, sessionStore_, namingService, logger, git, resolver, ticketStore_);
  const getSessionGroups = new GetSessionGroupsUseCase(sessionStore_, tmux, groupingService, logger, enrichClaudeActivity, discoverSessions, ticketStore_, personaStore_, agentEventStore_, reconcileWorktree, hostFs, config, namingService);

  // Claude Code hook event processor (POST /api/hook). On SessionEnd it also
  // ingests finished manual CLI sessions (source='cli') for cost tracking, then
  // persists their decision trail as a `cli-session-summary` deliverable.
  const ingestCliSession = new IngestCliSessionUseCase(ticketStore_, agentEventStore_, logger);
  const generateCliSessionSummary = new GenerateCliSessionSummaryUseCase(deliverableStore, logger, sdkLimiter);
  generateCliSessionSummary.eventBus = eventBus;
  const processHookEvent = new ProcessHookEventUseCase(sessionStore_, eventBus, logger, ingestCliSession, generateCliSessionSummary);

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
    instance,

    /**
     * Subscribe to every agent event this server surfaces, local or relayed. The
     * WS layer registers here instead of assigning `executeAgent.onEvent`, which
     * would evict the hub publisher.
     */
    addAgentEventListener: (listener: AgentEventListener) => {
      agentEventListeners.push(listener);
    },

    /**
     * Declare which remote executions local browsers are watching. Idempotent
     * snapshot: the WS layer recomputes and calls this on every subscribe,
     * unsubscribe and disconnect.
     */
    setAgentStreamDemand: (executionIds: Iterable<string>) => {
      localStreamDemand = new Set(executionIds);
      hubClient?.setAgentStreamDemand(localStreamDemand);
    },

    /**
     * Pull an execution's event history from the instance that owns it, mirroring
     * it locally as the events arrive. Resolves `answered: false` when nobody
     * responds in time (owner offline, or history pruned).
     */
    requestRemoteEventHistory: async (executionId: string) => {
      const requestId = hubClient?.requestAgentBackfill(executionId);
      if (!requestId) return { answered: false, count: 0, elided: false };
      return agentBackfills.await(requestId);
    },

    ticketBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    agentBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    personaBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    skillBroadcast: ((_type: string, _data: unknown) => {}) as (type: string, data: unknown) => void,
    agentEventBroadcast: ((_msg: unknown) => {}) as (msg: unknown) => void,
    jsonlFileWatcher: undefined,
  };
}

export type Container = Awaited<ReturnType<typeof createContainer>>;
