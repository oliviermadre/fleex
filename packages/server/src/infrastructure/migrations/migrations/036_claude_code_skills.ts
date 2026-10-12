import { randomUUID } from 'node:crypto';
import type { Migration } from '../types.js';

/**
 * Claude Code skills (SKILL.md found on the machine) mirrored as Fleex primitives.
 *
 * - `claude_code_skills`: one read-only mirror row per discovered skill and per
 *   machine (`host_id`). Several Fleex servers can share one database, each only
 *   ever reads its own host's rows. `repo` is '' for non-project origins so it
 *   can sit in the unique key on every dialect.
 * - Seeds the system persona `claude-code` that runs imported skills by default
 *   (`persona_id IS NULL` on a row means "use that persona"). Idempotent: an
 *   existing persona with that name is reused as-is.
 */
const SYSTEM_PERSONA_SOUL =
  'Tu exécutes des skills Claude Code. Tu appelles le skill demandé via le tool Skill, '
  + 'tu suis ses instructions et tu rapportes le résultat.';

const migration: Migration = {
  name: '036_claude_code_skills',

  async up(ctx) {
    const tableSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS claude_code_skills (
        id TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        native_name TEXT NOT NULL,
        command_name TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        allowed_tools TEXT,
        plugin TEXT,
        repo TEXT NOT NULL DEFAULT '',
        source_path TEXT NOT NULL,
        real_path TEXT,
        content_hash TEXT NOT NULL DEFAULT '',
        activated_hash TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        persona_id TEXT,
        status TEXT NOT NULL DEFAULT 'present',
        parse_error TEXT,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS claude_code_skills (
        id TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        native_name TEXT NOT NULL,
        command_name TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        allowed_tools JSONB,
        plugin TEXT,
        repo TEXT NOT NULL DEFAULT '',
        source_path TEXT NOT NULL,
        real_path TEXT,
        content_hash TEXT NOT NULL DEFAULT '',
        activated_hash TEXT,
        enabled BOOLEAN NOT NULL DEFAULT false,
        persona_id TEXT,
        status TEXT NOT NULL DEFAULT 'present',
        parse_error TEXT,
        last_seen_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS claude_code_skills (
        id TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        native_name TEXT NOT NULL,
        command_name TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        allowed_tools JSONB,
        plugin TEXT,
        repo TEXT NOT NULL DEFAULT '',
        source_path TEXT NOT NULL,
        real_path TEXT,
        content_hash TEXT NOT NULL DEFAULT '',
        activated_hash TEXT,
        enabled BOOLEAN NOT NULL DEFAULT false,
        persona_id TEXT,
        status TEXT NOT NULL DEFAULT 'present',
        parse_error TEXT,
        last_seen_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (tableSql) await ctx.exec(tableSql);

    await ctx.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_skills_identity ON claude_code_skills(host_id, origin, native_name, repo)',
    );
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_cc_skills_host_command ON claude_code_skills(host_id, command_name)');

    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE claude_code_skills ENABLE ROW LEVEL SECURITY');
      await ctx.exec(
        `CREATE POLICY "service_role_claude_code_skills" ON claude_code_skills FOR ALL USING (true) WITH CHECK (true)`,
      );
    }

    // ── System persona "Claude Code" (idempotent on name) ──
    const now = new Date().toISOString();
    const soul = SYSTEM_PERSONA_SOUL.replace(/'/g, "''");
    await ctx.exec(`INSERT INTO agent_personas
        (id, name, display_name, model, soul_md, identity_md, memory_md, human_mention_name, created_at, updated_at)
      SELECT '${randomUUID()}', 'claude-code', 'Claude Code', 'claude-sonnet-5', '${soul}', '', '', NULL, '${now}', '${now}'
      WHERE NOT EXISTS (SELECT 1 FROM agent_personas WHERE name = 'claude-code')`);
  },

  async down(ctx) {
    // The seeded persona is left in place: it may own executions and comments.
    await ctx.exec('DROP TABLE IF EXISTS claude_code_skills');
  },
};

export default migration;
