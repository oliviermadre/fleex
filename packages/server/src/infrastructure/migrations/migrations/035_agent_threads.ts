import type { Migration } from '../types.js';

/**
 * Phase 3 of the Work view: assistant ⇄ agent threads.
 *
 * Strictly additive so an older server (main) keeps booting on a database that
 * already carries it: one new table, two nullable columns. Every statement is
 * guarded so a re-run is a no-op.
 */
const migration: Migration = {
  name: '035_agent_threads',

  async up(ctx) {
    const ts = ctx.dialect({ sqlite: 'TEXT', pgsql: 'TIMESTAMPTZ', supabase: 'TIMESTAMPTZ' });

    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS agent_threads (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        initiator TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        persona_name TEXT NOT NULL,
        assistant_persona_id TEXT NOT NULL,
        brief TEXT NOT NULL,
        forwarded_context TEXT NOT NULL,
        status TEXT NOT NULL,
        current_mention_id TEXT,
        exchanges INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        created_at ${ts} NOT NULL,
        updated_at ${ts} NOT NULL,
        concluded_at ${ts}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_agent_threads_ticket ON agent_threads(ticket_id)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_agent_threads_mention ON agent_threads(current_mention_id)');

    // Nullable columns. SQLite has no ADD COLUMN IF NOT EXISTS: same try/catch
    // idempotence as migration 021.
    for (const stmt of [
      'ALTER TABLE comments ADD COLUMN thread_id TEXT',
      'ALTER TABLE tickets ADD COLUMN assistant_persona_id TEXT',
    ]) {
      try {
        await ctx.exec(stmt);
      } catch {
        // Column already exists.
      }
    }
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id)');

    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE agent_threads ENABLE ROW LEVEL SECURITY');
      try {
        await ctx.exec(`CREATE POLICY "service_role_agent_threads" ON agent_threads FOR ALL USING (true) WITH CHECK (true)`);
      } catch {
        // Policy already exists.
      }
      // PostgREST caches the schema: make the new table and columns visible now.
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS agent_threads');
    // The two nullable columns stay: dropping a column on SQLite means a table
    // rebuild, and an unused nullable column is harmless.
    if (ctx.adapter === 'supabase') await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
  },
};

export default migration;
