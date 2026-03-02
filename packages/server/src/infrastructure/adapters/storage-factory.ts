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
  if (driver === 'json') {
    return createJsonStores(deps);
  }

  // Sessions are always stored locally (JSON) — they are ephemeral tmux data,
  // not ticketing data. Using a remote store causes network-race flickering.
  const sessionStore = await createJsonSessionStore(deps);

  switch (driver) {
    case 'sqlite':
      return { sessionStore, ...(await createSqliteStores(deps.logger)) };
    case 'pgsql':
      return { sessionStore, ...(await createPgsqlStores(deps.logger)) };
    case 'supabase':
      return { sessionStore, ...(await createSupabaseStores(deps.logger)) };
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

async function createSqliteStores(logger: LoggerPort): Promise<NonSessionStores> {
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { ASM_DIR } = await import('@asm/shared');
  const { SqliteConnection } = await import('./sqlite/connection.js');
  const { SqliteTicketStoreAdapter } = await import('./sqlite/sqlite-ticket-store.adapter.js');
  const { SqliteAgentTokenStoreAdapter } = await import('./sqlite/sqlite-agent-token-store.adapter.js');
  const { SqliteCommentStoreAdapter } = await import('./sqlite/sqlite-comment-store.adapter.js');
  const { SqliteMentionStoreAdapter } = await import('./sqlite/sqlite-mention-store.adapter.js');
  const { SqliteDeliverableStoreAdapter } = await import('./sqlite/sqlite-deliverable-store.adapter.js');

  const dbPath = process.env['ASM_SQLITE_PATH'] ?? join(homedir(), ASM_DIR, 'asm.db');
  const connection = new SqliteConnection(dbPath);
  await connection.init();

  logger.info('SQLite storage initialized', { path: dbPath });

  return {
    ticketStore: new SqliteTicketStoreAdapter(connection),
    agentTokenStore: new SqliteAgentTokenStoreAdapter(connection),
    commentStore: new SqliteCommentStoreAdapter(connection),
    mentionStore: new SqliteMentionStoreAdapter(connection),
    deliverableStore: new SqliteDeliverableStoreAdapter(connection),
  };
}

async function createPgsqlStores(logger: LoggerPort): Promise<NonSessionStores> {
  const url = process.env['ASM_PGSQL_URL'];
  if (!url) {
    throw new Error('ASM_PGSQL_URL is required when ASM_STORAGE_DRIVER=pgsql');
  }

  const { PgConnection } = await import('./pgsql/connection.js');
  const { PgTicketStore } = await import('./pgsql/pg-ticket-store.adapter.js');
  const { PgAgentTokenStore } = await import('./pgsql/pg-agent-token-store.adapter.js');
  const { PgCommentStore } = await import('./pgsql/pg-comment-store.adapter.js');
  const { PgMentionStore } = await import('./pgsql/pg-mention-store.adapter.js');
  const { PgDeliverableStore } = await import('./pgsql/pg-deliverable-store.adapter.js');

  const connection = new PgConnection(url);
  await connection.init();

  logger.info('PostgreSQL storage initialized', { url: url.replace(/:[^:@]+@/, ':***@') });

  return {
    ticketStore: new PgTicketStore(connection),
    agentTokenStore: new PgAgentTokenStore(connection),
    commentStore: new PgCommentStore(connection),
    mentionStore: new PgMentionStore(connection),
    deliverableStore: new PgDeliverableStore(connection),
  };
}

async function createSupabaseStores(logger: LoggerPort): Promise<NonSessionStores> {
  const url = process.env['ASM_SUPABASE_URL'];
  const key = process.env['ASM_SUPABASE_KEY'];
  if (!url || !key) {
    throw new Error(
      'ASM_SUPABASE_URL and ASM_SUPABASE_KEY are required when ASM_STORAGE_DRIVER=supabase',
    );
  }

  const { SupabaseConnection } = await import('./supabase/connection.js');
  const { SupabaseTicketStore } = await import('./supabase/supabase-ticket-store.adapter.js');
  const { SupabaseAgentTokenStore } = await import('./supabase/supabase-agent-token-store.adapter.js');
  const { SupabaseCommentStore } = await import('./supabase/supabase-comment-store.adapter.js');
  const { SupabaseMentionStore } = await import('./supabase/supabase-mention-store.adapter.js');
  const { SupabaseDeliverableStore } = await import('./supabase/supabase-deliverable-store.adapter.js');

  const connection = new SupabaseConnection(url, key);
  await connection.init();

  logger.info('Supabase storage initialized', { url });

  return {
    ticketStore: new SupabaseTicketStore(connection),
    agentTokenStore: new SupabaseAgentTokenStore(connection),
    commentStore: new SupabaseCommentStore(connection),
    mentionStore: new SupabaseMentionStore(connection),
    deliverableStore: new SupabaseDeliverableStore(connection),
  };
}
