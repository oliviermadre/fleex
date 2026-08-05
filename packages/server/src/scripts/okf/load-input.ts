/**
 * Driver-agnostic loader for the OKF export.
 *
 * Reads the full Fleex knowledge base through the existing storage adapters —
 * whichever driver `FLEEX_STORAGE_DRIVER` selects (supabase | sqlite | pgsql)
 * — and returns an {@link OkfInput} snapshot plus a `close()` to release
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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { TicketRelationship } from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';
import type { TicketGroupStorePort } from '../../application/ports/ticket-group-store.port.js';
import type { CommentStorePort } from '../../application/ports/comment-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { MentionStorePort } from '../../application/ports/mention-store.port.js';
import type { PersonaStorePort } from '../../application/ports/persona-store.port.js';
import type { PanelStorePort } from '../../application/ports/panel-store.port.js';
import type { SkillStorePort } from '../../application/ports/skill-store.port.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';
import type { RoutineStorePort } from '../../application/ports/routine-store.port.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { StorageDriver } from '../../infrastructure/adapters/storage-factory.js';
import type { OkfInput } from './build-bundle.js';

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
  /**
   * `null` on drivers with no routine support (pgsql) — same boundary as
   * `workflowStore`, cf. `storage-factory`. When null the bundle simply has no
   * routines section rather than failing the export.
   */
  routineStore: RoutineStorePort | null;
  /** `null` alongside `routineStore` — runs are how a deliverable finds its routine. */
  runStore: WorkflowRunStorePort | null;
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
      routines,
      runs,
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
      stores.routineStore ? stores.routineStore.getAll() : Promise.resolve([]),
      stores.runStore ? stores.runStore.getAll() : Promise.resolve([]),
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
      routines: routines.map((r) => r.toDTO()),
      // Only routine-anchored runs: a ticket run's deliverables are already
      // exported under their ticket, so carrying those runs would duplicate
      // them in the bundle.
      routineRuns: runs.map((r) => r.toDTO()).filter((r) => !!r.routineId),
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
  const { SupabaseConnection } = await import('../../infrastructure/adapters/supabase/connection.js');
  const { SupabaseTicketStore } = await import('../../infrastructure/adapters/supabase/supabase-ticket-store.adapter.js');
  const { SupabaseTicketGroupStore } = await import('../../infrastructure/adapters/supabase/supabase-ticket-group-store.adapter.js');
  const { SupabaseCommentStore } = await import('../../infrastructure/adapters/supabase/supabase-comment-store.adapter.js');
  const { SupabaseDeliverableStore } = await import('../../infrastructure/adapters/supabase/supabase-deliverable-store.adapter.js');
  const { SupabaseMentionStore } = await import('../../infrastructure/adapters/supabase/supabase-mention-store.adapter.js');
  const { SupabasePersonaStore } = await import('../../infrastructure/adapters/supabase/supabase-persona-store.adapter.js');
  const { SupabasePanelStore } = await import('../../infrastructure/adapters/supabase/supabase-panel-store.adapter.js');
  const { SupabaseSkillStore } = await import('../../infrastructure/adapters/supabase/supabase-skill-store.adapter.js');
  const { SupabaseWorkflowTemplateStore } = await import('../../infrastructure/adapters/supabase/supabase-workflow-template-store.adapter.js');
  const { SupabaseRoutineStore } = await import('../../infrastructure/adapters/supabase/supabase-routine-store.adapter.js');
  const { SupabaseWorkflowRunStore } = await import('../../infrastructure/adapters/supabase/supabase-workflow-run-store.adapter.js');

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
    routineStore: new SupabaseRoutineStore(conn),
    runStore: new SupabaseWorkflowRunStore(conn),
    close: () => conn.close(),
  };
}

async function createSqliteStores(): Promise<KnowledgeStores> {
  const { SqliteConnection } = await import('../../infrastructure/adapters/sqlite/connection.js');
  const { SqliteTicketStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js');
  const { SqliteTicketGroupStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-ticket-group-store.adapter.js');
  const { SqliteCommentStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-comment-store.adapter.js');
  const { SqliteDeliverableStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-deliverable-store.adapter.js');
  const { SqliteMentionStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-mention-store.adapter.js');
  const { SqlitePersonaStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-persona-store.adapter.js');
  const { SqlitePanelStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-panel-store.adapter.js');
  const { SqliteSkillStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-skill-store.adapter.js');
  const { SqliteWorkflowTemplateStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-workflow-template-store.adapter.js');
  const { SqliteRoutineStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-routine-store.adapter.js');
  const { SqliteWorkflowRunStoreAdapter } = await import('../../infrastructure/adapters/sqlite/sqlite-workflow-run-store.adapter.js');

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
    routineStore: new SqliteRoutineStoreAdapter(conn),
    runStore: new SqliteWorkflowRunStoreAdapter(conn),
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
  const { PgTicketStore } = await import('../../infrastructure/adapters/pgsql/pg-ticket-store.adapter.js');
  const { PgTicketGroupStore } = await import('../../infrastructure/adapters/pgsql/pg-ticket-group-store.adapter.js');
  const { PgCommentStore } = await import('../../infrastructure/adapters/pgsql/pg-comment-store.adapter.js');
  const { PgDeliverableStore } = await import('../../infrastructure/adapters/pgsql/pg-deliverable-store.adapter.js');
  const { PgMentionStore } = await import('../../infrastructure/adapters/pgsql/pg-mention-store.adapter.js');
  const { PgPersonaStore } = await import('../../infrastructure/adapters/pgsql/pg-persona-store.adapter.js');
  const { PgPanelStore } = await import('../../infrastructure/adapters/pgsql/pg-panel-store.adapter.js');
  const { PgSkillStore } = await import('../../infrastructure/adapters/pgsql/pg-skill-store.adapter.js');

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
    routineStore: null, // …and therefore no routines either
    runStore: null,
    close: () => conn.close(),
  };
}

