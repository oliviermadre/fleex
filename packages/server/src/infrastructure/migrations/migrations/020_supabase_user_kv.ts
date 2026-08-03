import type { Migration } from '../types.js';

/**
 * Supabase-only: create the `users` and `user_kv` tables.
 *
 * These two tables were historically only defined in
 * `adapters/supabase/schema.sql` and had to be created manually in the Supabase
 * SQL Editor — the baseline migration (001) left the KV store as `supabase: null`.
 * Supabase projects provisioned via migrations alone therefore lacked `user_kv`,
 * which made all KV-backed features (comment read cursors, seen-deliverable state,
 * and the kanban unread/total counts) silently no-op because
 * `SupabaseKvStoreAdapter` swallows errors on a missing table.
 *
 * Fully idempotent: every statement uses IF NOT EXISTS / ON CONFLICT DO NOTHING,
 * and policies are dropped-then-recreated. On a project that already ran
 * schema.sql this is a no-op.
 */
const migration: Migration = {
  name: '020_supabase_user_kv',

  async up(ctx) {
    if (ctx.adapter !== 'supabase') return;

    // ── Users (seed the default single-user row used as DEFAULT_USER_ID) ──
    await ctx.exec(`CREATE TABLE IF NOT EXISTS users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email       TEXT UNIQUE NOT NULL,
      name        TEXT,
      avatar_url  TEXT,
      provider    TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      preferences JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(provider, provider_id)
    )`);

    await ctx.exec(`INSERT INTO users (id, email, name, provider, provider_id)
      VALUES ('00000000-0000-0000-0000-000000000000', 'local@localhost', 'Local User', 'local', 'local')
      ON CONFLICT (id) DO NOTHING`);

    // ── User KV store (comment cursors, seen deliverables, scratchpad, …) ──
    await ctx.exec(`CREATE TABLE IF NOT EXISTS user_kv (
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      value       JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    )`);

    // ── RLS (permissive service-role policy, per CLAUDE.md) ──
    for (const table of ['users', 'user_kv']) {
      await ctx.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await ctx.exec(`DROP POLICY IF EXISTS "service_role_${table}" ON ${table}`);
      await ctx.exec(
        `CREATE POLICY "service_role_${table}" ON ${table} FOR ALL USING (true) WITH CHECK (true)`,
      );
    }
  },

  async down(ctx) {
    if (ctx.adapter !== 'supabase') return;

    // Drop user_kv first (FK to users). Leave the `users` table in place: other
    // Supabase deployments may depend on it and it predates this migration.
    try {
      await ctx.exec(`DROP POLICY IF EXISTS "service_role_user_kv" ON user_kv`);
      await ctx.exec(`DROP TABLE IF EXISTS user_kv`);
    } catch {
      // Table may not exist
    }
  },
};

export default migration;
