#!/usr/bin/env bun
/**
 * Export the entire Fleex knowledge base (boards, epics, tickets, public
 * discussions, deliverables, agents, workflows) from Supabase into a
 * deterministic OKF v0.1 bundle under `~/.fleex/okf`.
 *
 * Usage:
 *   FLEEX_STORAGE_DRIVER=supabase \
 *   FLEEX_SUPABASE_URL=… FLEEX_SUPABASE_KEY=… \
 *   bun packages/server/src/scripts/export-okf.ts [--out <dir>] [--dry-run] [--quiet]
 *
 * Determinism: data access goes through the existing Supabase adapters (so the
 * snake_case→camelCase mapping never diverges from migrations); the rendering
 * is a pure DTO→string transform (`buildBundle`). Same DB ⇒ byte-identical
 * output. See spec §7.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { FLEEX_DIR } from '@fleex/shared';
import { SupabaseConnection } from '../infrastructure/adapters/supabase/connection.js';
import { SupabaseTicketStore } from '../infrastructure/adapters/supabase/supabase-ticket-store.adapter.js';
import { SupabaseTicketGroupStore } from '../infrastructure/adapters/supabase/supabase-ticket-group-store.adapter.js';
import { SupabaseCommentStore } from '../infrastructure/adapters/supabase/supabase-comment-store.adapter.js';
import { SupabaseDeliverableStore } from '../infrastructure/adapters/supabase/supabase-deliverable-store.adapter.js';
import { SupabaseMentionStore } from '../infrastructure/adapters/supabase/supabase-mention-store.adapter.js';
import { SupabasePersonaStore } from '../infrastructure/adapters/supabase/supabase-persona-store.adapter.js';
import { SupabasePanelStore } from '../infrastructure/adapters/supabase/supabase-panel-store.adapter.js';
import { SupabaseSkillStore } from '../infrastructure/adapters/supabase/supabase-skill-store.adapter.js';
import { SupabaseWorkflowTemplateStore } from '../infrastructure/adapters/supabase/supabase-workflow-template-store.adapter.js';
import { buildBundle, type OkfInput } from './okf/build-bundle.js';
import type { TicketGroupMembership, TicketRelationship } from '@fleex/shared';

interface Args {
  out: string;
  dryRun: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const defaultOut = join(homedir(), FLEEX_DIR, 'okf');
  const args: Args = { out: defaultOut, dryRun: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i] ?? defaultOut;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--quiet') args.quiet = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = (msg: string) => {
    if (!args.quiet) console.log(`[okf] ${msg}`);
  };

  const url = process.env['FLEEX_SUPABASE_URL'];
  const key = process.env['FLEEX_SUPABASE_KEY'];
  if (!url || !key) {
    console.error('FLEEX_SUPABASE_URL and FLEEX_SUPABASE_KEY are required');
    process.exit(1);
  }

  const conn = new SupabaseConnection(url, key);
  await conn.init();

  try {
    log('Reading knowledge from Supabase…');
    const ticketStore = new SupabaseTicketStore(conn);
    const groupStore = new SupabaseTicketGroupStore(conn);
    const commentStore = new SupabaseCommentStore(conn);
    const deliverableStore = new SupabaseDeliverableStore(conn);
    const mentionStore = new SupabaseMentionStore(conn);
    const personaStore = new SupabasePersonaStore(conn);
    const panelStore = new SupabasePanelStore(conn);
    const skillStore = new SupabaseSkillStore(conn);
    const workflowStore = new SupabaseWorkflowTemplateStore(conn);

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
      ticketStore.getAllBoards(),
      groupStore.getAllTicketGroups(),
      ticketStore.getAllTickets(),
      commentStore.getAll(),
      deliverableStore.getAll(),
      mentionStore.getAll(),
      personaStore.getAll(),
      panelStore.getAll(),
      skillStore.getAll(),
      workflowStore.getAll(),
    ]);

    // Junction tables have no `getAll` on the adapters; read the pair tables
    // directly via the REST client (no entity mapping involved — just pairs).
    const [memberships, relationships] = await Promise.all([
      readMemberships(conn),
      readRelationships(conn),
    ]);

    const input: OkfInput = {
      boards: boards.map((b) => b.toDTO()),
      epics: epics.map((e) => e.toDTO()),
      tickets: tickets.map((t) => t.toDTO()),
      comments: comments.map((c) => c.toDTO()),
      deliverables: deliverables.map((d) => d.toDTO()),
      mentions: mentions.map((m) => m.toDTO()),
      memberships,
      relationships,
      personas: personas.map((p) => p.toDTO()),
      panels: panels.map((p) => p.toDTO()),
      skills: skills.map((s) => s.toDTO()),
      workflows: workflows.map((w) => w.toDTO()),
    };

    log(
      `Loaded: ${input.boards.length} boards, ${input.epics.length} epics, ` +
        `${input.tickets.length} tickets, ${input.deliverables.length} deliverables, ` +
        `${input.personas.length} personas, ${input.panels.length} panels, ` +
        `${input.skills.length} skills, ${input.workflows.length} workflows.`,
    );

    const files = buildBundle(input);
    log(`Rendered ${files.length} files.`);

    if (args.dryRun) {
      log('--dry-run: not writing. Planned files:');
      for (const f of files) console.log(`  ${f.path}`);
      return;
    }

    await cleanDir(args.out);
    for (const file of files) {
      const full = join(args.out, file.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, file.content, 'utf8');
    }
    log(`Wrote ${files.length} files to ${args.out}`);
  } finally {
    await conn.close();
  }
}

/** Remove every entry in `dir` except a top-level `.git` folder (spec §7.6). */
async function cleanDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((e) => e.name !== '.git')
      .map((e) => rm(join(dir, e.name), { recursive: true, force: true })),
  );
}

async function readMemberships(conn: SupabaseConnection): Promise<TicketGroupMembership[]> {
  const { data, error } = await conn.client.from('ticket_group_memberships').select('ticket_id, group_id');
  if (error) throw new Error(`Failed to read ticket_group_memberships: ${error.message}`);
  return (data as Array<{ ticket_id: string; group_id: string }>).map((r) => ({
    ticketId: r.ticket_id,
    groupId: r.group_id,
  }));
}

async function readRelationships(conn: SupabaseConnection): Promise<TicketRelationship[]> {
  const { data, error } = await conn.client.from('ticket_relationships').select('parent_id, child_id');
  if (error) throw new Error(`Failed to read ticket_relationships: ${error.message}`);
  return (data as Array<{ parent_id: string; child_id: string }>).map((r) => ({
    parentId: r.parent_id,
    childId: r.child_id,
  }));
}

main().catch((err) => {
  console.error('[okf] Export failed:', err);
  process.exit(1);
});
