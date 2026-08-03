import type { Migration } from '../types.js';

/**
 * Persisted Claude Code hook status on `sessions`.
 *
 * Fed by `POST /api/hook` from the `fleex hook` CLI shim — see
 * packages/shared/src/types/hook-events.ts and the ticket #119 deliverables.
 *
 * Columns:
 *   - hook_status              ('unknown'|'working'|'waiting'|'complete'|'error'|'idle')
 *   - hook_waiting_reason      ('permission'|'idle'|'question'|NULL)
 *   - hook_last_message        last assistant message / error_type for tooltips
 *   - hook_status_updated_at   ISO timestamp of the last hook-driven transition
 *
 * The columns are nullable / defaulted so existing rows don't break.
 */
const migration: Migration = {
  name: '017_add_session_hook_status',

  async up(ctx) {
    if (ctx.adapter === 'json') return; // JSON adapter persists the entity blob — no schema change

    // ── hook_status ──
    const statusSql = ctx.dialect({
      sqlite: `ALTER TABLE sessions ADD COLUMN hook_status TEXT NOT NULL DEFAULT 'unknown'`,
      pgsql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_status TEXT NOT NULL DEFAULT 'unknown'`,
      supabase: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_status TEXT NOT NULL DEFAULT 'unknown'`,
      json: null,
    });
    if (statusSql) await ctx.exec(statusSql);

    // ── hook_waiting_reason ──
    const reasonSql = ctx.dialect({
      sqlite: `ALTER TABLE sessions ADD COLUMN hook_waiting_reason TEXT`,
      pgsql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_waiting_reason TEXT`,
      supabase: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_waiting_reason TEXT`,
      json: null,
    });
    if (reasonSql) await ctx.exec(reasonSql);

    // ── hook_last_message ──
    const messageSql = ctx.dialect({
      sqlite: `ALTER TABLE sessions ADD COLUMN hook_last_message TEXT`,
      pgsql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_last_message TEXT`,
      supabase: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_last_message TEXT`,
      json: null,
    });
    if (messageSql) await ctx.exec(messageSql);

    // ── hook_status_updated_at ──
    const updatedAtSql = ctx.dialect({
      sqlite: `ALTER TABLE sessions ADD COLUMN hook_status_updated_at TEXT`,
      pgsql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_status_updated_at TIMESTAMPTZ`,
      supabase: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hook_status_updated_at TIMESTAMPTZ`,
      json: null,
    });
    if (updatedAtSql) await ctx.exec(updatedAtSql);

    // Useful when the watchdog scans for stale `waiting` sessions.
    const idxSql = `CREATE INDEX IF NOT EXISTS idx_sessions_hook_status ON sessions(hook_status)`;
    await ctx.exec(idxSql);
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;

    await ctx.exec(`DROP INDEX IF EXISTS idx_sessions_hook_status`);

    const cols = [
      'hook_status_updated_at',
      'hook_last_message',
      'hook_waiting_reason',
      'hook_status',
    ];
    for (const col of cols) {
      const sql = ctx.dialect({
        sqlite: `ALTER TABLE sessions DROP COLUMN ${col}`,
        pgsql: `ALTER TABLE sessions DROP COLUMN IF EXISTS ${col}`,
        supabase: `ALTER TABLE sessions DROP COLUMN IF EXISTS ${col}`,
        json: null,
      });
      if (sql) {
        try {
          await ctx.exec(sql);
        } catch {
          // SQLite < 3.35 doesn't support DROP COLUMN — harmless legacy fields remain.
        }
      }
    }
  },
};

export default migration;
