import { vi } from 'vitest';
import { EventBus } from '../../src/application/event-bus.js';
import { registerAuditTrail } from '../../src/infrastructure/audit-trail-registrar.js';
import { DomainEventListener } from '../../src/application/domain-event-listener.js';
import { RemoteDomainEventListener } from '../../src/application/remote-domain-event-listener.js';
import { createStores } from '../../src/infrastructure/adapters/storage-factory.js';
import { CachedSessionStore } from '../../src/infrastructure/adapters/cached-session-store.js';
import { CachedTicketStore } from '../../src/infrastructure/adapters/cached-ticket-store.js';
import { CachedPersonaStore } from '../../src/infrastructure/adapters/cached-persona-store.js';
import { CachedAgentEventStore } from '../../src/infrastructure/adapters/cached-agent-event-store.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { SessionNamingService } from '../../src/domain/services/session-naming.js';
import { CreateSessionUseCase } from '../../src/application/use-cases/create-session.js';
import { RenameSessionUseCase } from '../../src/application/use-cases/rename-session.js';
import { ListSessionsUseCase } from '../../src/application/use-cases/list-sessions.js';
import { KillSessionUseCase } from '../../src/application/use-cases/kill-session.js';
import { DiscoverExistingSessionsUseCase } from '../../src/application/use-cases/discover-existing-sessions.js';
import { ProcessHookEventUseCase } from '../../src/application/use-cases/process-hook-event.js';
import { IngestCliSessionUseCase } from '../../src/application/use-cases/ingest-cli-session.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { ResolveMentionUseCase } from '../../src/application/use-cases/resolve-mention.js';
import { SubmitDeliverableUseCase } from '../../src/application/use-cases/submit-deliverable.js';
import { GetRelevantSummariesUseCase } from '../../src/application/use-cases/get-relevant-summaries.js';
import { GetTicketContextUseCase } from '../../src/application/use-cases/get-ticket-context.js';
import { ManageDeliverableTypesUseCase } from '../../src/application/use-cases/manage-deliverable-types.js';
import { CreatePersonaUseCase } from '../../src/application/use-cases/create-persona.js';
import { UpdatePersonaUseCase } from '../../src/application/use-cases/update-persona.js';
import { DeletePersonaUseCase } from '../../src/application/use-cases/delete-persona.js';
import { CreateSkillUseCase } from '../../src/application/use-cases/create-skill.js';
import { UpdateSkillUseCase } from '../../src/application/use-cases/update-skill.js';
import { DeleteSkillUseCase } from '../../src/application/use-cases/delete-skill.js';
import { CreatePanelUseCase } from '../../src/application/use-cases/create-panel.js';
import { UpdatePanelUseCase } from '../../src/application/use-cases/update-panel.js';
import { DeletePanelUseCase } from '../../src/application/use-cases/delete-panel.js';
import { DetectMergeUseCase } from '../../src/application/use-cases/detect-merge.js';
import { BackfillPRTicketUseCase } from '../../src/application/use-cases/backfill-pr-ticket.js';
import type { Container } from '../../src/infrastructure/container.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import { FakeTmuxPort, FakeGitPort, FakeLoggerPort } from './fakes.js';
import { NodeHostFs, makeTempHome } from './node-host-fs.js';
import { InMemoryWorkflowTemplateStore } from './in-memory-workflow-template-store.js';
import { FakeSessionManager, FakeUserStore } from './fake-auth.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL AND WHAT IS STUBBED
 * ────────────────────────────────────────────────────────────────────────────
 * This table is the contract of the integration-test container. Keep it in
 * sync when you change the wiring below.
 *
 *  REAL (json driver on a temp $HOME, via the production storage factory —
 *  migrations included):
 *    config, sessionStore, ticketStore, personaStore, agentEventStore,
 *    agentTokenStore, commentStore, mentionStore, deliverableStore, skillStore,
 *    panelStore, domainEventLogStore, fileStore, fileMetaStore,
 *    ticketGroupStore
 *
 *  REAL use cases (pure orchestration over those stores):
 *    postComment, resolveMention, submitDeliverable, getTicketContext,
 *    getRelevantSummaries, manageDeliverableTypes, create/update/deletePersona,
 *    create/update/deleteSkill, create/update/deletePanel, detectMerge,
 *    backfillPRTicket, listSessions, killSession, createSession,
 *    renameSession, discoverSessions, processHookEvent
 *
 *  REAL infrastructure:
 *    eventBus (+ a recorder on '*'), remoteEventBus, resolver
 *
 *  FAKES:
 *    tmux (FakeTmuxPort), git (FakeGitPort), logger (FakeLoggerPort),
 *    hostFs (NodeHostFs on the temp home), execFn/shellExecFn (no-op)
 *
 *  STUBS (vi.fn) — expensive, external, or SDK-driven:
 *    executeAgent, runPanel, wakeWaitingAgents, autoReviewWorkflow,
 *    generateTicketSummary, importGitHubIssue, importSlackMessage,
 *    createSessionFromTicket, createWorktree, reconcileWorktree,
 *    getClaudeUsage, enrichClaudeActivity, githubGraphql, githubDiscovery,
 *    repositoryResolver, repositoryRefreshScheduler, repositoryCache,
 *    bareCloneManager, overlayManager, listRepositories, listWorktrees, pty
 *
 *  DELIBERATE OMISSIONS:
 *    - `domainEventListener` is CONSTRUCTED (the WS plugin calls
 *      setTicketBroadcast on it) but NEVER `.register()`-ed. Registering it
 *      would make "post a comment with @agent:x" spawn a real Claude Agent SDK
 *      execution.
 *    - `getSessionGroups` is a stub returning []. The real use case pulls in a
 *      dozen collaborators and is invoked eagerly by the unified-WS plugin at
 *      registration time (refreshDiffStats). `/api/sessions/groups` is
 *      therefore NOT covered by these tests — see the spec's debt list.
 *    - `workflowRunStore` / `stepRunStore` and their use cases stay null, so
 *      `/api/workflows/runs*` is never registered (asserted in app-wiring).
 *    - `hubClient` is null and `kvStore` is null, matching the json driver.
 */

export type TestAuthMode = 'none' | 'db-no-oauth' | 'full';

export interface TestContainerOptions {
  /**
   * 'none' (default) leaves sessionManager null → auth-middleware mode 1.
   * 'db-no-oauth' and 'full' both install a FakeSessionManager; which mode the
   * middleware picks then depends on the OAuth env vars, which the caller must
   * stub with `vi.stubEnv` BEFORE calling createTestApp (the middleware reads
   * them once, at construction).
   */
  auth?: TestAuthMode;
  /** Default true — installs an in-memory workflow template store. */
  workflowTemplates?: boolean;
  /** Applied last, over everything else. */
  overrides?: Partial<Container>;
}

export interface TestContainerHandle {
  container: Container;
  /** The temp $HOME every JSON store writes into. */
  home: string;
  /** Every event emitted on the real eventBus, in order. */
  events: AnyDomainEvent[];
  sessionManager: FakeSessionManager | null;
  dispose(): Promise<void>;
}

export async function createTestContainer(
  opts: TestContainerOptions = {},
): Promise<TestContainerHandle> {
  const tmp = await makeTempHome();
  const logger = new FakeLoggerPort();
  const hostFs = new NodeHostFs();
  const execFn = vi.fn(async () => ({ stdout: '', stderr: '' }));
  const shellExecFn = vi.fn(async () => ({ stdout: '', stderr: '' }));

  // Real production storage factory: runs the JSON migrations and builds every
  // Json* adapter against the temp home.
  const stores = await createStores('json', {
    execFn,
    hostFs,
    homedir: tmp.home,
    logger,
  });

  const config = stores.configStore;
  const sessionStore = new CachedSessionStore(stores.sessionStore);
  await sessionStore.warmUp();
  const ticketStore = new CachedTicketStore(stores.ticketStore);
  await ticketStore.warmUp();
  const personaStore = new CachedPersonaStore(stores.personaStore);
  await personaStore.warmUp();
  const agentEventStore = new CachedAgentEventStore(stores.agentEventStore);
  await agentEventStore.warmUp();

  const {
    agentTokenStore,
    commentStore,
    mentionStore,
    deliverableStore,
    domainEventLogStore,
    skillStore,
    panelStore,
    fileStore,
    fileMetaStore,
    ticketGroupStore,
  } = stores;

  const tmux = new FakeTmuxPort();
  const git = new FakeGitPort();
  const namingService = new SessionNamingService();
  const resolver = new RepoPathResolver(config.get().basePath);

  const eventBus = new EventBus();
  const remoteEventBus = new EventBus();
  const events: AnyDomainEvent[] = [];
  eventBus.on('*', (e) => {
    events.push(e);
  });

  // The production audit sink, wired to the real (temp-dir) log store rather
  // than reimplemented here. `events` records what was BROADCAST;
  // `domainEventLogStore` records what was AUDITED. Keeping both observable is
  // what lets a test assert that `?silent=true` still syncs other clients while
  // writing no audit row.
  registerAuditTrail(eventBus, domainEventLogStore, 'test-instance');

  // Real, cheap use cases.
  const postComment = new PostCommentUseCase(commentStore, mentionStore, ticketStore, logger);
  const resolveMention = new ResolveMentionUseCase(mentionStore, ticketStore, logger);
  const submitDeliverable = new SubmitDeliverableUseCase(deliverableStore, ticketStore, config, logger);
  const getRelevantSummaries = new GetRelevantSummariesUseCase(deliverableStore, ticketStore);
  const getTicketContext = new GetTicketContextUseCase(
    ticketStore, commentStore, mentionStore, deliverableStore, getRelevantSummaries, ticketGroupStore,
  );
  const manageDeliverableTypes = new ManageDeliverableTypesUseCase(config, deliverableStore, logger, eventBus);
  const createSession = new CreateSessionUseCase(tmux, sessionStore, namingService, git, config, logger);
  const renameSession = new RenameSessionUseCase(tmux, sessionStore, namingService, logger);
  const detectMerge = new DetectMergeUseCase(ticketStore, logger);
  const backfillPRTicket = new BackfillPRTicketUseCase(ticketStore, logger);
  const discoverSessions = new DiscoverExistingSessionsUseCase(
    tmux, sessionStore, namingService, logger, git, resolver, ticketStore,
  );
  const ingestCliSession = new IngestCliSessionUseCase(ticketStore, agentEventStore, logger);
  const generateCliSessionSummary = { execute: vi.fn(async () => {}) };
  const processHookEvent = new ProcessHookEventUseCase(
    sessionStore, eventBus, logger, ingestCliSession,
    generateCliSessionSummary as never,
  );

  const executeAgent = stub({
    execute: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    subscribeToBus: vi.fn(),
    terminate: vi.fn(async () => false),
    getRunningExecutions: vi.fn(() => []),
    isRunning: vi.fn(() => false),
  });
  const runPanel = stub({ execute: vi.fn(async () => {}) });
  const generateTicketSummary = stub({ execute: vi.fn(async () => {}) });
  const autoReviewWorkflow = stub({ execute: vi.fn(async () => {}) });

  const createPersona = new CreatePersonaUseCase(personaStore, logger);
  const updatePersona = new UpdatePersonaUseCase(personaStore, logger);
  const deletePersona = new DeletePersonaUseCase(personaStore, logger);
  const createSkill = new CreateSkillUseCase(skillStore, personaStore, logger);
  const updateSkill = new UpdateSkillUseCase(skillStore, personaStore, logger);
  const deleteSkill = new DeleteSkillUseCase(skillStore, logger);
  const createPanel = new CreatePanelUseCase(panelStore, personaStore, logger);
  const updatePanel = new UpdatePanelUseCase(panelStore, personaStore, logger);
  const deletePanel = new DeletePanelUseCase(panelStore, logger);

  const workflowTemplateStore = opts.workflowTemplates === false
    ? null
    : new InMemoryWorkflowTemplateStore();

  let userStore: FakeUserStore | null = null;
  let sessionManager: FakeSessionManager | null = null;
  if (opts.auth && opts.auth !== 'none') {
    userStore = new FakeUserStore();
    sessionManager = new FakeSessionManager();
  }

  const base = {
    logger,
    gatewayUrl: 'http://localhost:3001',
    execFn,
    shellExecFn,
    hostFs,
    hostHomedir: tmp.home,
    config,
    tmux,
    pty: stub({
      spawnAttach: vi.fn(() => { throw new Error('pty not available in tests'); }),
    }),
    git,
    userStore,
    sessionManager,
    sessionStore,
    repositoryCache: stub({
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      set: vi.fn(),
    }),
    githubGraphql: stub({
      fetchRepositorySummary: vi.fn(async () => null),
      fetchIssue: vi.fn(async () => null),
    }),
    repositoryResolver: stub({ resolve: vi.fn(async () => []) }),
    githubDiscovery: stub({ listOrgs: vi.fn(async () => []), listRepos: vi.fn(async () => []) }),
    repositoryRefreshScheduler: stub({
      setRepos: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      setBroadcast: vi.fn(),
      setCheckRepoExists: vi.fn(),
      setOnMergedPRs: vi.fn(),
      refreshNow: vi.fn(async () => {}),
    }),
    resolver,
    bareCloneManager: stub({
      syncWithConfig: vi.fn(async () => {}),
      ensureBareClone: vi.fn(async () => {}),
    }),
    overlayManager: stub({
      apply: vi.fn(async () => {}),
      sync: vi.fn(async () => ({ files: [] })),
    }),
    createSession,
    renameSession,
    listSessions: new ListSessionsUseCase(sessionStore, tmux, logger),
    killSession: new KillSessionUseCase(tmux, sessionStore, logger),
    // Stubbed on purpose: the real use case is eagerly invoked by the WS plugin
    // and drags in a dozen collaborators. /api/sessions/groups stays uncovered.
    getSessionGroups: stub({ execute: vi.fn(async () => []) }),
    discoverSessions,
    processHookEvent,
    listRepositories: stub({ execute: vi.fn(async () => []) }),
    listWorktrees: stub({ execute: vi.fn(async () => []) }),
    createWorktree: stub({ execute: vi.fn(async () => ({ path: '/tmp/wt', branch: 'main' })) }),
    getClaudeUsage: stub({ execute: vi.fn(async () => null) }),
    agentTokenStore,
    ticketStore,
    detectMerge,
    createSessionFromTicket: stub({ execute: vi.fn(async () => null) }),
    importGitHubIssue: stub({ execute: vi.fn(async () => null) }),
    importSlackMessage: stub({ execute: vi.fn(async () => null) }),
    backfillPRTicket,
    commentStore,
    mentionStore,
    deliverableStore,
    postComment,
    resolveMention,
    submitDeliverable,
    manageDeliverableTypes,
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
    wakeWaitingAgents: stub({ execute: vi.fn(async () => {}) }),
    generateTicketSummary,
    getRelevantSummaries,
    autoReviewWorkflow,
    panelStore,
    createPanel,
    updatePanel,
    deletePanel,
    runPanel,
    agentEventStore,
    domainEventLogStore,
    kvStore: null,
    fileStore,
    fileMetaStore,
    ticketGroupStore,
    workflowTemplateStore,
    workflowRunStore: null,
    stepRunStore: null,
    workflowOrchestrator: null,
    createWorkflowRun: null,
    resolveHumanGate: null,
    retryStep: null,
    cancelWorkflowRun: null,
    eventBus,
    remoteEventBus,
    hubClient: null,
    serverId: 'test-server',
    ticketBroadcast: (() => {}) as (type: string, data: unknown) => void,
    agentBroadcast: (() => {}) as (type: string, data: unknown) => void,
    personaBroadcast: (() => {}) as (type: string, data: unknown) => void,
    skillBroadcast: (() => {}) as (type: string, data: unknown) => void,
    agentEventBroadcast: (() => {}) as (msg: unknown) => void,
    jsonlFileWatcher: undefined,
  };

  // Constructed so the WS plugin can call setTicketBroadcast on it, but
  // NEVER registered — see the header comment.
  const domainEventListener = new DomainEventListener({
    eventBus,
    personaStore,
    skillStore,
    ticketStore,
    mentionStore,
    commentStore,
    deliverableStore,
    autoReviewWorkflow: autoReviewWorkflow as never,
    executeAgent: executeAgent as never,
    wakeWaitingAgents: base.wakeWaitingAgents as never,
    runPanel: runPanel as never,
    generateTicketSummary: generateTicketSummary as never,
    logger,
  });
  const remoteDomainEventListener = new RemoteDomainEventListener(
    remoteEventBus,
    domainEventListener.getBroadcastRegistrar(),
  );

  const container = {
    ...base,
    domainEventListener,
    remoteDomainEventListener,
    ...(opts.overrides ?? {}),
  } as unknown as Container;

  return {
    container,
    home: tmp.home,
    events,
    sessionManager,
    dispose: tmp.dispose,
  };
}

/** Narrow helper so stub objects keep their inferred shape instead of collapsing to `any`. */
function stub<T extends object>(value: T): T {
  return value;
}
