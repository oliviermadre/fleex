import type { SessionStorePort } from '../../application/ports/session-store.port.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';
import type { AgentTokenStorePort } from '../../application/ports/agent-token-store.port.js';
import type { CommentStorePort } from '../../application/ports/comment-store.port.js';
import type { MentionStorePort } from '../../application/ports/mention-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { PersonaStorePort } from '../../application/ports/persona-store.port.js';
import type { AgentEventStorePort } from '../../application/ports/agent-event-store.port.js';
import type { DomainEventLogStorePort } from '../../application/ports/domain-event-log-store.port.js';
import type { ConfigPort } from '../../application/ports/config.port.js';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import type { SkillStorePort } from '../../application/ports/skill-store.port.js';
import type { PanelStorePort } from '../../application/ports/panel-store.port.js';
import type { FileStorePort } from '../../application/ports/file-store.port.js';
import type { FileMetaStorePort } from '../../application/ports/file-meta-store.port.js';
import type { TicketGroupStorePort } from '../../application/ports/ticket-group-store.port.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../../application/ports/step-run-store.port.js';
import type { RoutineStorePort } from '../../application/ports/routine-store.port.js';
import type { MemoryStorePort } from '../../application/ports/memory-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn, HostFs } from '../host/types.js';

export type StorageDriver = 'sqlite' | 'pgsql' | 'supabase';

export interface StorageStores {
  configStore: ConfigPort;
  sessionStore: SessionStorePort;
  ticketStore: TicketStorePort;
  agentTokenStore: AgentTokenStorePort;
  commentStore: CommentStorePort;
  mentionStore: MentionStorePort;
  deliverableStore: DeliverableStorePort;
  personaStore: PersonaStorePort;
  agentEventStore: AgentEventStorePort;
  domainEventLogStore: DomainEventLogStorePort;
  skillStore: SkillStorePort;
  panelStore: PanelStorePort;
  kvStore: KvStorePort | null;
  fileStore: FileStorePort;
  fileMetaStore: FileMetaStorePort;
  ticketGroupStore: TicketGroupStorePort;
  workflowTemplateStore: WorkflowTemplateStorePort | null;
  workflowRunStore: WorkflowRunStorePort | null;
  stepRunStore: StepRunStorePort | null;
  routineStore: RoutineStorePort | null;
  /**
   * Retrieval index for the semantic memory engine. Null on drivers with no
   * implementation yet — the engine reports itself unavailable and retrieval
   * stays on the legacy ranking rather than failing.
   */
  memoryStore: MemoryStorePort | null;
}

export function resolveStorageDriver(): StorageDriver {
  const raw = process.env['FLEEX_STORAGE_DRIVER']?.toLowerCase() ?? 'sqlite';
  const valid: StorageDriver[] = ['sqlite', 'pgsql', 'supabase'];
  if (!valid.includes(raw as StorageDriver)) {
    throw new Error(
      `Invalid FLEEX_STORAGE_DRIVER="${raw}". Must be one of: ${valid.join(', ')}`,
    );
  }
  return raw as StorageDriver;
}

export async function createStores(
  driver: StorageDriver,
  deps: { execFn: ExecFn; hostFs: HostFs; homedir: string; logger: LoggerPort },
): Promise<StorageStores> {
  // Sessions are always stored locally — they are ephemeral tmux data,
  // not ticketing data. Using a remote store causes network-race flickering.
  const sessionStore = await createLocalSessionStore(deps);

  switch (driver) {
    case 'sqlite':
      return { sessionStore, ...(await createSqliteStores(deps)) };
    case 'pgsql':
      return { sessionStore, ...(await createPgsqlStores(deps)) };
    case 'supabase':
      return { sessionStore, ...(await createSupabaseStores(deps)) };
  }
}

async function createLocalSessionStore(deps: {
  hostFs: HostFs;
  homedir: string;
  logger: LoggerPort;
}): Promise<SessionStorePort> {
  const { LocalSessionStore } = await import('./local-session-store.adapter.js');
  const store = new LocalSessionStore(deps.hostFs, deps.homedir, deps.logger);
  await store.init();
  return store;
}

type NonSessionStores = Omit<StorageStores, 'sessionStore'>;

async function createSqliteStores(deps: {
  execFn: ExecFn;
  hostFs: HostFs;
  homedir: string;
  logger: LoggerPort;
}): Promise<NonSessionStores> {
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { FLEEX_DIR } = await import('@fleex/shared');
  const { SqliteConnection } = await import('./sqlite/connection.js');
  const { SqliteConfigAdapter } = await import('./sqlite/sqlite-config.adapter.js');
  const { SqliteTicketStoreAdapter } = await import('./sqlite/sqlite-ticket-store.adapter.js');
  const { SqliteAgentTokenStoreAdapter } = await import('./sqlite/sqlite-agent-token-store.adapter.js');
  const { SqliteCommentStoreAdapter } = await import('./sqlite/sqlite-comment-store.adapter.js');
  const { SqliteMentionStoreAdapter } = await import('./sqlite/sqlite-mention-store.adapter.js');
  const { SqliteDeliverableStoreAdapter } = await import('./sqlite/sqlite-deliverable-store.adapter.js');
  const { SqlitePersonaStoreAdapter } = await import('./sqlite/sqlite-persona-store.adapter.js');
  const { SqliteAgentEventStoreAdapter } = await import('./sqlite/sqlite-agent-event-store.adapter.js');
  const { SqliteDomainEventLogStoreAdapter } = await import('./sqlite/sqlite-domain-event-log-store.adapter.js');
  const { SqliteKvStoreAdapter } = await import('./sqlite/sqlite-kv-store.adapter.js');
  const { SqliteSkillStoreAdapter } = await import('./sqlite/sqlite-skill-store.adapter.js');
  const { SqlitePanelStoreAdapter } = await import('./sqlite/sqlite-panel-store.adapter.js');
  const { DiskFileStoreAdapter } = await import('./disk-file-store.adapter.js');
  const { SqliteFileMetaStoreAdapter } = await import('./sqlite/sqlite-file-meta-store.adapter.js');
  const { SqliteTicketGroupStoreAdapter } = await import('./sqlite/sqlite-ticket-group-store.adapter.js');
  const { SqliteWorkflowTemplateStoreAdapter } = await import('./sqlite/sqlite-workflow-template-store.adapter.js');
  const { SqliteWorkflowRunStoreAdapter } = await import('./sqlite/sqlite-workflow-run-store.adapter.js');
  const { SqliteStepRunStoreAdapter } = await import('./sqlite/sqlite-step-run-store.adapter.js');
  const { SqliteRoutineStoreAdapter } = await import('./sqlite/sqlite-routine-store.adapter.js');
  const { SqliteMemoryStoreAdapter } = await import('./sqlite/sqlite-memory-store.adapter.js');

  const dbPath = process.env['FLEEX_SQLITE_PATH'] ?? join(homedir(), FLEEX_DIR, 'fleex.db');
  const connection = new SqliteConnection(dbPath);
  await connection.init();

  // Run pending migrations
  const { runPendingMigrations } = await import('../migrations/run-migrations.js');
  await runPendingMigrations('sqlite', connection, deps.logger);

  const configStore = new SqliteConfigAdapter(connection, deps.execFn, deps.hostFs, deps.homedir);
  await configStore.init();

  const agentEventStore = new SqliteAgentEventStoreAdapter(connection);
  await agentEventStore.init();

  deps.logger.info('SQLite storage initialized', { path: dbPath });

  return {
    configStore,
    ticketStore: new SqliteTicketStoreAdapter(connection),
    agentTokenStore: new SqliteAgentTokenStoreAdapter(connection),
    commentStore: new SqliteCommentStoreAdapter(connection),
    mentionStore: new SqliteMentionStoreAdapter(connection),
    deliverableStore: new SqliteDeliverableStoreAdapter(connection),
    personaStore: new SqlitePersonaStoreAdapter(connection),
    agentEventStore,
    domainEventLogStore: new SqliteDomainEventLogStoreAdapter(connection),
    skillStore: new SqliteSkillStoreAdapter(connection),
    panelStore: new SqlitePanelStoreAdapter(connection),
    kvStore: new SqliteKvStoreAdapter(connection),
    fileStore: new DiskFileStoreAdapter(deps.homedir),
    fileMetaStore: new SqliteFileMetaStoreAdapter(connection),
    ticketGroupStore: new SqliteTicketGroupStoreAdapter(connection),
    workflowTemplateStore: new SqliteWorkflowTemplateStoreAdapter(connection),
    workflowRunStore: new SqliteWorkflowRunStoreAdapter(connection),
    stepRunStore: new SqliteStepRunStoreAdapter(connection),
    routineStore: new SqliteRoutineStoreAdapter(connection),
    memoryStore: new SqliteMemoryStoreAdapter(connection),
  };
}

async function createPgsqlStores(deps: {
  execFn: ExecFn;
  hostFs: HostFs;
  homedir: string;
  logger: LoggerPort;
}): Promise<NonSessionStores> {
  const url = process.env['FLEEX_PGSQL_URL'];
  if (!url) {
    throw new Error('FLEEX_PGSQL_URL is required when FLEEX_STORAGE_DRIVER=pgsql');
  }

  const { PgConnection } = await import('./pgsql/connection.js');
  const { PgConfigAdapter } = await import('./pgsql/pg-config.adapter.js');
  const { PgTicketStore } = await import('./pgsql/pg-ticket-store.adapter.js');
  const { PgAgentTokenStore } = await import('./pgsql/pg-agent-token-store.adapter.js');
  const { PgCommentStore } = await import('./pgsql/pg-comment-store.adapter.js');
  const { PgMentionStore } = await import('./pgsql/pg-mention-store.adapter.js');
  const { PgDeliverableStore } = await import('./pgsql/pg-deliverable-store.adapter.js');
  const { PgPersonaStore } = await import('./pgsql/pg-persona-store.adapter.js');
  const { PgAgentEventStore } = await import('./pgsql/pg-agent-event-store.adapter.js');
  const { PgDomainEventLogStore } = await import('./pgsql/pg-domain-event-log-store.adapter.js');
  const { PgKvStoreAdapter } = await import('./pgsql/pg-kv-store.adapter.js');
  const { PgSkillStore } = await import('./pgsql/pg-skill-store.adapter.js');
  const { PgPanelStore } = await import('./pgsql/pg-panel-store.adapter.js');
  const { DiskFileStoreAdapter } = await import('./disk-file-store.adapter.js');
  const { PgFileMetaStore } = await import('./pgsql/pg-file-meta-store.adapter.js');
  const { PgTicketGroupStore } = await import('./pgsql/pg-ticket-group-store.adapter.js');

  const connection = new PgConnection(url);
  await connection.init();

  // Run pending migrations
  const { runPendingMigrations } = await import('../migrations/run-migrations.js');
  await runPendingMigrations('pgsql', connection, deps.logger);

  const configStore = new PgConfigAdapter(connection, deps.execFn, deps.hostFs, deps.homedir);
  await configStore.init();

  const agentEventStore = new PgAgentEventStore(connection);
  await agentEventStore.init();

  const domainEventLogStore = new PgDomainEventLogStore(connection);
  await domainEventLogStore.init();

  deps.logger.info('PostgreSQL storage initialized', { url: url.replace(/:[^:@]+@/, ':***@') });

  return {
    configStore,
    ticketStore: new PgTicketStore(connection),
    agentTokenStore: new PgAgentTokenStore(connection),
    commentStore: new PgCommentStore(connection),
    mentionStore: new PgMentionStore(connection),
    deliverableStore: new PgDeliverableStore(connection),
    personaStore: new PgPersonaStore(connection),
    agentEventStore,
    domainEventLogStore,
    skillStore: new PgSkillStore(connection),
    panelStore: new PgPanelStore(connection),
    kvStore: new PgKvStoreAdapter(connection),
    fileStore: new DiskFileStoreAdapter(deps.homedir),
    fileMetaStore: new PgFileMetaStore(connection),
    ticketGroupStore: new PgTicketGroupStore(connection),
    workflowTemplateStore: null,
    workflowRunStore: null,
    stepRunStore: null,
    routineStore: null,
    // pgsql has no memory store yet; the semantic engine stays unavailable.
    memoryStore: null,
  };
}

async function createSupabaseStores(deps: {
  execFn: ExecFn;
  hostFs: HostFs;
  homedir: string;
  logger: LoggerPort;
}): Promise<NonSessionStores> {
  const url = process.env['FLEEX_SUPABASE_URL'];
  const key = process.env['FLEEX_SUPABASE_KEY'];
  if (!url || !key) {
    throw new Error(
      'FLEEX_SUPABASE_URL and FLEEX_SUPABASE_KEY are required when FLEEX_STORAGE_DRIVER=supabase',
    );
  }

  const { SupabaseConnection } = await import('./supabase/connection.js');
  const { SupabaseConfigAdapter } = await import('./supabase/supabase-config.adapter.js');
  const { SupabaseTicketStore } = await import('./supabase/supabase-ticket-store.adapter.js');
  const { SupabaseAgentTokenStore } = await import('./supabase/supabase-agent-token-store.adapter.js');
  const { SupabaseCommentStore } = await import('./supabase/supabase-comment-store.adapter.js');
  const { SupabaseMentionStore } = await import('./supabase/supabase-mention-store.adapter.js');
  const { SupabaseDeliverableStore } = await import('./supabase/supabase-deliverable-store.adapter.js');
  const { SupabasePersonaStore } = await import('./supabase/supabase-persona-store.adapter.js');
  const { SupabaseAgentEventStore } = await import('./supabase/supabase-agent-event-store.adapter.js');
  const { SupabaseDomainEventLogStore } = await import('./supabase/supabase-domain-event-log-store.adapter.js');
  const { SupabaseKvStoreAdapter } = await import('./supabase/supabase-kv-store.adapter.js');
  const { SupabaseSkillStore } = await import('./supabase/supabase-skill-store.adapter.js');
  const { SupabasePanelStore } = await import('./supabase/supabase-panel-store.adapter.js');
  const { SupabaseFileStoreAdapter } = await import('./supabase/supabase-file-store.adapter.js');
  const { SupabaseFileMetaStore } = await import('./supabase/supabase-file-meta-store.adapter.js');
  const { SupabaseTicketGroupStore } = await import('./supabase/supabase-ticket-group-store.adapter.js');
  const { SupabaseWorkflowTemplateStore } = await import('./supabase/supabase-workflow-template-store.adapter.js');
  const { SupabaseWorkflowRunStore } = await import('./supabase/supabase-workflow-run-store.adapter.js');
  const { SupabaseStepRunStore } = await import('./supabase/supabase-step-run-store.adapter.js');
  const { SupabaseRoutineStore } = await import('./supabase/supabase-routine-store.adapter.js');

  const dbUrl = process.env['FLEEX_SUPABASE_DB_URL'];
  const connection = new SupabaseConnection(url, key, dbUrl, deps.logger);
  await connection.init();

  // Run pending migrations
  const { runPendingMigrations } = await import('../migrations/run-migrations.js');
  await runPendingMigrations('supabase', connection, deps.logger);

  const configStore = new SupabaseConfigAdapter(connection, deps.execFn, deps.hostFs, deps.homedir);
  await configStore.init();

  const agentEventStore = new SupabaseAgentEventStore(connection);
  await agentEventStore.init();

  deps.logger.info('Supabase storage initialized', { url });

  return {
    configStore,
    ticketStore: new SupabaseTicketStore(connection),
    agentTokenStore: new SupabaseAgentTokenStore(connection),
    commentStore: new SupabaseCommentStore(connection),
    mentionStore: new SupabaseMentionStore(connection),
    deliverableStore: new SupabaseDeliverableStore(connection),
    personaStore: new SupabasePersonaStore(connection),
    agentEventStore,
    domainEventLogStore: new SupabaseDomainEventLogStore(connection),
    skillStore: new SupabaseSkillStore(connection),
    panelStore: new SupabasePanelStore(connection),
    kvStore: new SupabaseKvStoreAdapter(connection),
    fileStore: new SupabaseFileStoreAdapter(connection),
    fileMetaStore: new SupabaseFileMetaStore(connection),
    ticketGroupStore: new SupabaseTicketGroupStore(connection),
    workflowTemplateStore: new SupabaseWorkflowTemplateStore(connection),
    workflowRunStore: new SupabaseWorkflowRunStore(connection),
    stepRunStore: new SupabaseStepRunStore(connection),
    routineStore: new SupabaseRoutineStore(connection),
    // supabase needs a pgvector-backed adapter; not implemented yet.
    memoryStore: null,
  };
}
