import type { SessionStorePort } from '../../application/ports/session-store.port.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';
import type { AgentTokenStorePort } from '../../application/ports/agent-token-store.port.js';
import type { CommentStorePort } from '../../application/ports/comment-store.port.js';
import type { MentionStorePort } from '../../application/ports/mention-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

export type StorageDriver = 'json' | 'sqlite' | 'pgsql' | 'supabase';

export interface StorageStores {
  sessionStore: SessionStorePort;
  ticketStore: TicketStorePort;
  agentTokenStore: AgentTokenStorePort;
  commentStore: CommentStorePort;
  mentionStore: MentionStorePort;
  deliverableStore: DeliverableStorePort;
}

export function resolveStorageDriver(): StorageDriver {
  const raw = process.env['ASM_STORAGE_DRIVER']?.toLowerCase() ?? 'json';
  const valid: StorageDriver[] = ['json', 'sqlite', 'pgsql', 'supabase'];
  if (!valid.includes(raw as StorageDriver)) {
    throw new Error(
      `Invalid ASM_STORAGE_DRIVER="${raw}". Must be one of: ${valid.join(', ')}`,
    );
  }
  return raw as StorageDriver;
}

export async function createStores(
  driver: StorageDriver,
  deps: { hostFs: HostFs; homedir: string; logger: LoggerPort },
): Promise<StorageStores> {
  switch (driver) {
    case 'json':
      return createJsonStores(deps);
    case 'sqlite':
      return createSqliteStores(deps.logger);
    case 'pgsql':
      return createPgsqlStores(deps.logger);
    case 'supabase':
      return createSupabaseStores(deps.logger);
  }
}

async function createJsonStores(deps: {
  hostFs: HostFs;
  homedir: string;
  logger: LoggerPort;
}): Promise<StorageStores> {
  const { JsonSessionStore } = await import('./json-session-store.adapter.js');
  const { JsonTicketStore } = await import('./json-ticket-store.adapter.js');
  const { JsonAgentTokenStore } = await import('./json-agent-token-store.adapter.js');
  const { JsonCommentStore } = await import('./json-comment-store.adapter.js');
  const { JsonMentionStore } = await import('./json-mention-store.adapter.js');
  const { JsonDeliverableStore } = await import('./json-deliverable-store.adapter.js');

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

  return { sessionStore, ticketStore, agentTokenStore, commentStore, mentionStore, deliverableStore };
}

async function createSqliteStores(logger: LoggerPort): Promise<StorageStores> {
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { ASM_DIR } = await import('@asm/shared');
  const { SqliteConnection } = await import('./sqlite/connection.js');
  const { SqliteSessionStore } = await import('./sqlite/sqlite-session-store.adapter.js');
  const { SqliteTicketStore } = await import('./sqlite/sqlite-ticket-store.adapter.js');
  const { SqliteAgentTokenStore } = await import('./sqlite/sqlite-agent-token-store.adapter.js');
  const { SqliteCommentStore } = await import('./sqlite/sqlite-comment-store.adapter.js');
  const { SqliteMentionStore } = await import('./sqlite/sqlite-mention-store.adapter.js');
  const { SqliteDeliverableStore } = await import('./sqlite/sqlite-deliverable-store.adapter.js');

  const dbPath = process.env['ASM_SQLITE_PATH'] ?? join(homedir(), ASM_DIR, 'asm.db');
  const connection = new SqliteConnection(dbPath);
  await connection.init();

  logger.info('SQLite storage initialized', { path: dbPath });

  return {
    sessionStore: new SqliteSessionStore(connection),
    ticketStore: new SqliteTicketStore(connection),
    agentTokenStore: new SqliteAgentTokenStore(connection),
    commentStore: new SqliteCommentStore(connection),
    mentionStore: new SqliteMentionStore(connection),
    deliverableStore: new SqliteDeliverableStore(connection),
  };
}

async function createPgsqlStores(logger: LoggerPort): Promise<StorageStores> {
  const url = process.env['ASM_PGSQL_URL'];
  if (!url) {
    throw new Error('ASM_PGSQL_URL is required when ASM_STORAGE_DRIVER=pgsql');
  }

  const { PgConnection } = await import('./pgsql/connection.js');
  const { PgSessionStore } = await import('./pgsql/pg-session-store.adapter.js');
  const { PgTicketStore } = await import('./pgsql/pg-ticket-store.adapter.js');
  const { PgAgentTokenStore } = await import('./pgsql/pg-agent-token-store.adapter.js');
  const { PgCommentStore } = await import('./pgsql/pg-comment-store.adapter.js');
  const { PgMentionStore } = await import('./pgsql/pg-mention-store.adapter.js');
  const { PgDeliverableStore } = await import('./pgsql/pg-deliverable-store.adapter.js');

  const connection = new PgConnection(url);
  await connection.init();

  logger.info('PostgreSQL storage initialized', { url: url.replace(/:[^:@]+@/, ':***@') });

  return {
    sessionStore: new PgSessionStore(connection),
    ticketStore: new PgTicketStore(connection),
    agentTokenStore: new PgAgentTokenStore(connection),
    commentStore: new PgCommentStore(connection),
    mentionStore: new PgMentionStore(connection),
    deliverableStore: new PgDeliverableStore(connection),
  };
}

async function createSupabaseStores(logger: LoggerPort): Promise<StorageStores> {
  const url = process.env['ASM_SUPABASE_URL'];
  const key = process.env['ASM_SUPABASE_KEY'];
  if (!url || !key) {
    throw new Error(
      'ASM_SUPABASE_URL and ASM_SUPABASE_KEY are required when ASM_STORAGE_DRIVER=supabase',
    );
  }

  const { SupabaseConnection } = await import('./supabase/connection.js');
  const { SupabaseSessionStore } = await import('./supabase/supabase-session-store.adapter.js');
  const { SupabaseTicketStore } = await import('./supabase/supabase-ticket-store.adapter.js');
  const { SupabaseAgentTokenStore } = await import('./supabase/supabase-agent-token-store.adapter.js');
  const { SupabaseCommentStore } = await import('./supabase/supabase-comment-store.adapter.js');
  const { SupabaseMentionStore } = await import('./supabase/supabase-mention-store.adapter.js');
  const { SupabaseDeliverableStore } = await import('./supabase/supabase-deliverable-store.adapter.js');

  const connection = new SupabaseConnection(url, key);
  await connection.init();

  logger.info('Supabase storage initialized', { url });

  return {
    sessionStore: new SupabaseSessionStore(connection),
    ticketStore: new SupabaseTicketStore(connection),
    agentTokenStore: new SupabaseAgentTokenStore(connection),
    commentStore: new SupabaseCommentStore(connection),
    mentionStore: new SupabaseMentionStore(connection),
    deliverableStore: new SupabaseDeliverableStore(connection),
  };
}
