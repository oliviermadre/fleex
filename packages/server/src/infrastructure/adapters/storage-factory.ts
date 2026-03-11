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
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn, HostFs } from '../host/types.js';

export type StorageDriver = 'json' | 'sqlite' | 'pgsql' | 'supabase';

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
  kvStore: KvStorePort | null;
}

export function resolveStorageDriver(): StorageDriver {
  const raw = process.env['FLEEX_STORAGE_DRIVER']?.toLowerCase() ?? 'json';
  const valid: StorageDriver[] = ['json', 'sqlite', 'pgsql', 'supabase'];
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
  if (driver === 'json') {
    return createJsonStores(deps);
  }

  // Sessions are always stored locally (JSON) — they are ephemeral tmux data,
  // not ticketing data. Using a remote store causes network-race flickering.
  const sessionStore = await createJsonSessionStore(deps);

  switch (driver) {
    case 'sqlite':
      return { sessionStore, ...(await createSqliteStores(deps)) };
    case 'pgsql':
      return { sessionStore, ...(await createPgsqlStores(deps)) };
    case 'supabase':
      return { sessionStore, ...(await createSupabaseStores(deps)) };
  }
}

async function createJsonStores(deps: {
  execFn: ExecFn;
  hostFs: HostFs;
  homedir: string;
  logger: LoggerPort;
}): Promise<StorageStores> {
  const { JsonConfigAdapter } = await import('./json-config.adapter.js');
  const { JsonSessionStore } = await import('./json-session-store.adapter.js');
  const { JsonTicketStore } = await import('./json-ticket-store.adapter.js');
  const { JsonAgentTokenStore } = await import('./json-agent-token-store.adapter.js');
  const { JsonCommentStore } = await import('./json-comment-store.adapter.js');
  const { JsonMentionStore } = await import('./json-mention-store.adapter.js');
  const { JsonDeliverableStore } = await import('./json-deliverable-store.adapter.js');
  const { JsonPersonaStore } = await import('./json-persona-store.adapter.js');
  const { JsonAgentEventStore } = await import('./json-agent-event-store.adapter.js');
  const { JsonDomainEventLogStore } = await import('./json-domain-event-log-store.adapter.js');

  // Run pending migrations (JSON adapter — tracking via _migrations.json)
  const { runPendingMigrations } = await import('../migrations/run-migrations.js');
  await runPendingMigrations('json', null, deps.logger, { homedir: deps.homedir });

  const configStore = new JsonConfigAdapter(deps.execFn, deps.hostFs, deps.homedir);
  await configStore.init();
  const sessionStore = new JsonSessionStore(deps.hostFs, deps.homedir, deps.logger);
  await sessionStore.init();
  const ticketStore = new JsonTicketStore(deps.hostFs, deps.homedir, deps.logger);
  await ticketStore.init();
  const agentTokenStore = new JsonAgentTokenStore(deps.hostFs, deps.homedir, deps.logger);
  await agentTokenStore.init();
  const commentStore = new JsonCommentStore(deps.hostFs, deps.homedir, deps.logger);
  await commentStore.init();
  const mentionStore = new JsonMentionStore(deps.hostFs, deps.homedir, deps.logger);
  await mentionStore.init();
  const deliverableStore = new JsonDeliverableStore(deps.hostFs, deps.homedir, deps.logger);
  await deliverableStore.init();
  const personaStore = new JsonPersonaStore(deps.hostFs, deps.homedir, deps.logger);
  await personaStore.init();
  const agentEventStore = new JsonAgentEventStore(deps.hostFs, deps.homedir, deps.logger);
  await agentEventStore.init();
  const domainEventLogStore = new JsonDomainEventLogStore(deps.hostFs, deps.homedir, deps.logger);
  await domainEventLogStore.init();

  return { configStore, sessionStore, ticketStore, agentTokenStore, commentStore, mentionStore, deliverableStore, personaStore, agentEventStore, domainEventLogStore, kvStore: null };
}

async function createJsonSessionStore(deps: {
  hostFs: HostFs;
  homedir: string;
  logger: LoggerPort;
}): Promise<SessionStorePort> {
  const { JsonSessionStore } = await import('./json-session-store.adapter.js');
  const store = new JsonSessionStore(deps.hostFs, deps.homedir, deps.logger);
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
    kvStore: new SqliteKvStoreAdapter(connection),
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
    kvStore: new PgKvStoreAdapter(connection),
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

  const dbUrl = process.env['FLEEX_SUPABASE_DB_URL'];
  const connection = new SupabaseConnection(url, key, dbUrl);
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
    kvStore: new SupabaseKvStoreAdapter(connection),
  };
}
