/**
 * Driver-agnostic loader for the OKF export.
 *
 * Reads the full Fleex knowledge base through the existing storage adapters —
 * whichever driver `FLEEX_STORAGE_DRIVER` selects (supabase | sqlite | pgsql |
 * json) — and returns an {@link OkfInput} snapshot plus a `close()` to release
 * the connection. The rendering (`buildBundle`) stays a pure DTO→string
 * transform; this module is the only place that touches a database.
 *
 * Why adapters (not raw SQL): the `toDTO()` mappers already encode the exact
 * snake_case→camelCase + JSONB handling the migrations produce, so the export
 * can never drift from the schema. Junction tables (memberships,
 * relationships) have no global `getAll` on the ports, so we aggregate them
 * uniformly through the per-group / per-ticket port methods — this works for
 * every driver instead of reaching into one driver's REST client.
 */
import { appendFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { FLEEX_DIR } from '@fleex/shared';
import type { TicketRelationship } from '@fleex/shared';

import type { OkfInput } from './build-bundle.js';
import type { CommentStorePort } from '../../application/ports/comment-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { MentionStorePort } from '../../application/ports/mention-store.port.js';
import type { PanelStorePort } from '../../application/ports/panel-store.port.js';
import type { PersonaStorePort } from '../../application/ports/persona-store.port.js';
import type { SkillStorePort } from '../../application/ports/skill-store.port.js';
import type { TicketGroupStorePort } from '../../application/ports/ticket-group-store.port.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';
import type { StorageDriver } from '../../infrastructure/adapters/storage-factory.js';
import type { HostFs } from '../../infrastructure/host/types.js';

/** The read-only slice of stores the OKF export needs, plus a connection closer. */
interface KnowledgeStores {
  ticketStore: TicketStorePort;
  groupStore: TicketGroupStorePort;
  commentStore: CommentStorePort;
  deliverableStore: DeliverableStorePort;
  mentionStore: MentionStorePort;
  personaStore: PersonaStorePort;
  panelStore: PanelStorePort;
  skillStore: SkillStorePort;
  /** `null` on drivers that ship no workflow-template store (pgsql, json). */
  workflowStore: WorkflowTemplateStorePort | null;
  close: () => Promise<void>;
}

/**
 * Load the whole knowledge base and return an {@link OkfInput} snapshot.
 * Always call the returned `close()` (even on error) to release the connection.
 */
export async function loadOkfInput(
  driver: StorageDriver,
  logger: LoggerPort,
): Promise<{ input: OkfInput; close: () => Promise<void> }> {
  const stores = await createKnowledgeStores(driver, logger);
  try {
    const [
      boards,
      epics,
      tickets,
      comments,
      deliverables,
      mentions,
      personas,
      panels,
      skills,
      workflows,
    ] = await Promise.all([
      stores.ticketStore.getAllBoards(),
      stores.groupStore.getAllTicketGroups(),
      stores.ticketStore.getAllTickets(),
      stores.commentStore.getAll(),
      stores.deliverableStore.getAll(),
      stores.mentionStore.getAll(),
      stores.personaStore.getAll(),
      stores.panelStore.getAll(),
      stores.skillStore.getAll(),
      stores.workflowStore ? stores.workflowStore.getAll() : Promise.resolve([]),
    ]);

    const epicDtos = epics.map((e) => e.toDTO());
    const ticketDtos = tickets.map((t) => t.toDTO());

    // Junction tables: aggregate through the per-group / per-ticket port
    // methods so this is identical on every driver. Iterating each ticket as a
    // parent visits every (parent → child) edge exactly once.
    const membershipLists = await Promise.all(
      epicDtos.map((g) => stores.groupStore.getMembershipsByGroup(g.id)),
    );
    const relationshipLists = await Promise.all(
      ticketDtos.map((t) => stores.groupStore.getChildRelationships(t.id)),
    );

    const input: OkfInput = {
      boards: boards.map((b) => b.toDTO()),
      epics: epicDtos,
      tickets: ticketDtos,
      comments: comments.map((c) => c.toDTO()),
      deliverables: deliverables.map((d) => d.toDTO()),
      mentions: mentions.map((m) => m.toDTO()),
      memberships: membershipLists.flat(),
      relationships: dedupeRelationships(relationshipLists.flat()),
      personas: personas.map((p) => p.toDTO()),
      panels: panels.map((p) => p.toDTO()),
      skills: skills.map((s) => s.toDTO()),
      workflows: workflows.map((w) => w.toDTO()),
    };

    return { input, close: stores.close };
  } catch (err) {
    await stores.close();
    throw err;
  }
}

/** Deduplicate (parentId, childId) pairs deterministically. */
function dedupeRelationships(rels: TicketRelationship[]): TicketRelationship[] {
  const seen = new Set<string>();
  const out: TicketRelationship[] = [];
  for (const r of rels) {
    const key = `${r.parentId}>${r.childId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function createKnowledgeStores(
  driver: StorageDriver,
  logger: LoggerPort,
): Promise<KnowledgeStores> {
  switch (driver) {
    case 'supabase':
      return createSupabaseStores(logger);
    case 'sqlite':
      return createSqliteStores();
    case 'pgsql':
      return createPgsqlStores();
    case 'json':
      return createJsonStores(logger);
  }
}

async function createSupabaseStores(logger: LoggerPort): Promise<KnowledgeStores> {
  const url = process.env['FLEEX_SUPABASE_URL'];
  const key = process.env['FLEEX_SUPABASE_KEY'];
  if (!url || !key) {
    throw new Error(
      'FLEEX_SUPABASE_URL and FLEEX_SUPABASE_KEY are required when FLEEX_STORAGE_DRIVER=supabase',
    );
  }
  const { SupabaseConnection } =
    await import('../../infrastructure/adapters/supabase/connection.js');
  const { SupabaseTicketStore } =
    await import('../../infrastructure/adapters/supabase/supabase-ticket-store.adapter.js');
  const { SupabaseTicketGroupStore } =
    await import('../../infrastructure/adapters/supabase/supabase-ticket-group-store.adapter.js');
  const { SupabaseCommentStore } =
    await import('../../infrastructure/adapters/supabase/supabase-comment-store.adapter.js');
  const { SupabaseDeliverableStore } =
    await import('../../infrastructure/adapters/supabase/supabase-deliverable-store.adapter.js');
  const { SupabaseMentionStore } =
    await import('../../infrastructure/adapters/supabase/supabase-mention-store.adapter.js');
  const { SupabasePersonaStore } =
    await import('../../infrastructure/adapters/supabase/supabase-persona-store.adapter.js');
  const { SupabasePanelStore } =
    await import('../../infrastructure/adapters/supabase/supabase-panel-store.adapter.js');
  const { SupabaseSkillStore } =
    await import('../../infrastructure/adapters/supabase/supabase-skill-store.adapter.js');
  const { SupabaseWorkflowTemplateStore } =
    await import('../../infrastructure/adapters/supabase/supabase-workflow-template-store.adapter.js');

  const dbUrl = process.env['FLEEX_SUPABASE_DB_URL'];
  const conn = new SupabaseConnection(url, key, dbUrl, logger);
  await conn.init();

  return {
    ticketStore: new SupabaseTicketStore(conn),
    groupStore: new SupabaseTicketGroupStore(conn),
    commentStore: new SupabaseCommentStore(conn),
    deliverableStore: new SupabaseDeliverableStore(conn),
    mentionStore: new SupabaseMentionStore(conn),
    personaStore: new SupabasePersonaStore(conn),
    panelStore: new SupabasePanelStore(conn),
    skillStore: new SupabaseSkillStore(conn),
    workflowStore: new SupabaseWorkflowTemplateStore(conn),
    close: () => conn.close(),
  };
}

async function createSqliteStores(): Promise<KnowledgeStores> {
  const { SqliteConnection } = await import('../../infrastructure/adapters/sqlite/connection.js');
  const { SqliteTicketStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js');
  const { SqliteTicketGroupStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-ticket-group-store.adapter.js');
  const { SqliteCommentStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-comment-store.adapter.js');
  const { SqliteDeliverableStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-deliverable-store.adapter.js');
  const { SqliteMentionStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-mention-store.adapter.js');
  const { SqlitePersonaStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-persona-store.adapter.js');
  const { SqlitePanelStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-panel-store.adapter.js');
  const { SqliteSkillStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-skill-store.adapter.js');
  const { SqliteWorkflowTemplateStoreAdapter } =
    await import('../../infrastructure/adapters/sqlite/sqlite-workflow-template-store.adapter.js');

  const dbPath = process.env['FLEEX_SQLITE_PATH'] ?? join(homedir(), FLEEX_DIR, 'fleex.db');
  const conn = new SqliteConnection(dbPath);
  await conn.init();

  return {
    ticketStore: new SqliteTicketStoreAdapter(conn),
    groupStore: new SqliteTicketGroupStoreAdapter(conn),
    commentStore: new SqliteCommentStoreAdapter(conn),
    deliverableStore: new SqliteDeliverableStoreAdapter(conn),
    mentionStore: new SqliteMentionStoreAdapter(conn),
    personaStore: new SqlitePersonaStoreAdapter(conn),
    panelStore: new SqlitePanelStoreAdapter(conn),
    skillStore: new SqliteSkillStoreAdapter(conn),
    workflowStore: new SqliteWorkflowTemplateStoreAdapter(conn),
    close: async () => {
      conn.close();
    },
  };
}

async function createPgsqlStores(): Promise<KnowledgeStores> {
  const url = process.env['FLEEX_PGSQL_URL'];
  if (!url) {
    throw new Error('FLEEX_PGSQL_URL is required when FLEEX_STORAGE_DRIVER=pgsql');
  }
  const { PgConnection } = await import('../../infrastructure/adapters/pgsql/connection.js');
  const { PgTicketStore } =
    await import('../../infrastructure/adapters/pgsql/pg-ticket-store.adapter.js');
  const { PgTicketGroupStore } =
    await import('../../infrastructure/adapters/pgsql/pg-ticket-group-store.adapter.js');
  const { PgCommentStore } =
    await import('../../infrastructure/adapters/pgsql/pg-comment-store.adapter.js');
  const { PgDeliverableStore } =
    await import('../../infrastructure/adapters/pgsql/pg-deliverable-store.adapter.js');
  const { PgMentionStore } =
    await import('../../infrastructure/adapters/pgsql/pg-mention-store.adapter.js');
  const { PgPersonaStore } =
    await import('../../infrastructure/adapters/pgsql/pg-persona-store.adapter.js');
  const { PgPanelStore } =
    await import('../../infrastructure/adapters/pgsql/pg-panel-store.adapter.js');
  const { PgSkillStore } =
    await import('../../infrastructure/adapters/pgsql/pg-skill-store.adapter.js');

  const conn = new PgConnection(url);
  await conn.init();

  return {
    ticketStore: new PgTicketStore(conn),
    groupStore: new PgTicketGroupStore(conn),
    commentStore: new PgCommentStore(conn),
    deliverableStore: new PgDeliverableStore(conn),
    mentionStore: new PgMentionStore(conn),
    personaStore: new PgPersonaStore(conn),
    panelStore: new PgPanelStore(conn),
    skillStore: new PgSkillStore(conn),
    workflowStore: null, // pgsql ships no workflow-template store (see storage-factory)
    close: () => conn.close(),
  };
}

async function createJsonStores(logger: LoggerPort): Promise<KnowledgeStores> {
  const { JsonTicketStore } =
    await import('../../infrastructure/adapters/json-ticket-store.adapter.js');
  const { JsonTicketGroupStore } =
    await import('../../infrastructure/adapters/json-ticket-group-store.adapter.js');
  const { JsonCommentStore } =
    await import('../../infrastructure/adapters/json-comment-store.adapter.js');
  const { JsonDeliverableStore } =
    await import('../../infrastructure/adapters/json-deliverable-store.adapter.js');
  const { JsonMentionStore } =
    await import('../../infrastructure/adapters/json-mention-store.adapter.js');
  const { JsonPersonaStore } =
    await import('../../infrastructure/adapters/json-persona-store.adapter.js');
  const { JsonPanelStore } =
    await import('../../infrastructure/adapters/json-panel-store.adapter.js');
  const { JsonSkillStore } =
    await import('../../infrastructure/adapters/json-skill-store.adapter.js');

  const fs = nodeHostFs();
  const home = homedir();
  const ticketStore = new JsonTicketStore(fs, home, logger);
  const groupStore = new JsonTicketGroupStore(fs, home, logger);
  const commentStore = new JsonCommentStore(fs, home, logger);
  const deliverableStore = new JsonDeliverableStore(fs, home, logger);
  const mentionStore = new JsonMentionStore(fs, home, logger);
  const personaStore = new JsonPersonaStore(fs, home, logger);
  const panelStore = new JsonPanelStore(fs, home, logger);
  const skillStore = new JsonSkillStore(fs, home, logger);
  await Promise.all([
    ticketStore.init(),
    groupStore.init(),
    commentStore.init(),
    deliverableStore.init(),
    mentionStore.init(),
    personaStore.init(),
    panelStore.init(),
    skillStore.init(),
  ]);

  return {
    ticketStore,
    groupStore,
    commentStore,
    deliverableStore,
    mentionStore,
    personaStore,
    panelStore,
    skillStore,
    workflowStore: null, // JSON driver ships no workflow-template store
    close: async () => {},
  };
}

/**
 * Minimal local {@link HostFs} backed by `node:fs` — the JSON stores read
 * `~/.fleex/projects/*.json` directly off disk. (The server normally talks to
 * the remote host-gateway; a standalone export script has no gateway.)
 */
function nodeHostFs(): HostFs {
  return {
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: async (path, content) => {
      await writeFile(path, content, 'utf8');
    },
    appendFile: async (path, content) => {
      await appendFile(path, content, 'utf8');
    },
    readdir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        isFile: e.isFile(),
        isDirectory: e.isDirectory(),
      }));
    },
    stat: async (path) => {
      try {
        const s = await stat(path);
        return { size: s.size, mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    },
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    rm: async (path, options) => {
      await rm(path, { recursive: options?.recursive ?? false, force: true });
    },
    readTail: async (path, bytes) => {
      const s = await stat(path);
      const start = Math.max(0, s.size - bytes);
      const length = s.size - start;
      const fh = await open(path, 'r');
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, start);
        return buf.toString('utf8');
      } finally {
        await fh.close();
      }
    },
  };
}
