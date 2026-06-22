import type { Migration } from '../types.js';

/**
 * Distinguish the *origin* of an execution: `sdk` (agentic — Fleex's own SDK
 * runs, the only kind recorded until now) vs `cli` (a manual `claude` CLI
 * session run inside a ticket worktree, ingested from its transcript).
 *
 * Existing rows stay NULL and are read as `sdk` (coalesce in get-statistics),
 * so this is non-destructive. CLI executions ingested afterwards set `source='cli'`.
 */
const migration: Migration = {
  name: '023_add_execution_source',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const stmt = ctx.dialect({
      sqlite: `ALTER TABLE agent_event_executions ADD COLUMN source TEXT`,
      pgsql: `ALTER TABLE agent_event_executions ADD COLUMN source TEXT`,
      supabase: `ALTER TABLE agent_event_executions ADD COLUMN source TEXT`,
      json: null,
    });
    if (!stmt) return;
    try {
      await ctx.exec(stmt);
    } catch {
      // Column may already exist (idempotent re-run).
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    if (ctx.adapter === 'sqlite') return; // older SQLite has no DROP COLUMN
    await ctx.exec(`ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS source`);
  },
};

export default migration;
