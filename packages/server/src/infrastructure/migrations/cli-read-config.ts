#!/usr/bin/env bun
/**
 * CLI entrypoint that prints the persisted `basePath` for the configured
 * storage backend as JSON: `{"basePath":"…"}`.
 *
 * Used by `fleex self-update` to migrate the worktree base path OUT of the
 * per-instance DB config and INTO ~/.fleex/workspaces.json for existing users.
 * It reads the raw `app_config` row directly via the same connection classes as
 * cli-migrate.ts (no HTTP server, no gateway) so it works headless.
 *
 * Environment variables (same as cli-migrate.ts):
 *   FLEEX_STORAGE_DRIVER  - json | sqlite | pgsql | supabase (default: json)
 *   FLEEX_SQLITE_PATH     - Path to SQLite database file
 *   FLEEX_PGSQL_URL       - PostgreSQL connection URL
 *   FLEEX_SUPABASE_URL / FLEEX_SUPABASE_KEY / FLEEX_SUPABASE_DB_URL
 *
 * On any error it prints `{"basePath":null}` and exits 0 — the caller treats a
 * missing value as "nothing to migrate" and must never be blocked.
 */

const driver = (process.env['FLEEX_STORAGE_DRIVER']?.toLowerCase() ?? 'json');
const DEFAULT_BASE_PATH = '~/projects';

/** Pull basePath out of a parsed app_config blob, honouring the legacy key. */
function pick(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const v = (data['basePath'] ?? data['repositoriesBasePath']) as unknown;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

async function readBasePath(): Promise<string | null> {
  if (driver === 'json') {
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { readFileSync, existsSync } = await import('node:fs');
    const { FLEEX_DIR, CONFIG_FILE } = await import('@fleex/shared');
    const file = join(homedir(), FLEEX_DIR, CONFIG_FILE);
    if (!existsSync(file)) return DEFAULT_BASE_PATH;
    try {
      return pick(JSON.parse(readFileSync(file, 'utf8'))) ?? DEFAULT_BASE_PATH;
    } catch {
      return DEFAULT_BASE_PATH;
    }
  }

  if (driver === 'sqlite') {
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { FLEEX_DIR } = await import('@fleex/shared');
    const { SqliteConnection } = await import('../adapters/sqlite/connection.js');
    const dbPath = process.env['FLEEX_SQLITE_PATH'] ?? join(homedir(), FLEEX_DIR, 'fleex.db');
    const conn = new SqliteConnection(dbPath);
    await conn.init();
    try {
      const row = conn.db.prepare('SELECT data FROM app_config WHERE id = ?').get('singleton') as
        | { data: string }
        | undefined;
      return pick(row ? JSON.parse(row.data) : null) ?? DEFAULT_BASE_PATH;
    } finally {
      conn.close();
    }
  }

  if (driver === 'pgsql') {
    const url = process.env['FLEEX_PGSQL_URL'];
    if (!url) return null;
    const { PgConnection } = await import('../adapters/pgsql/connection.js');
    const conn = new PgConnection(url);
    await conn.init();
    try {
      const { rows } = await conn.query('SELECT data FROM app_config WHERE id = $1', ['singleton']);
      const data = rows[0]?.data;
      return pick(typeof data === 'string' ? JSON.parse(data) : data) ?? DEFAULT_BASE_PATH;
    } finally {
      await conn.close();
    }
  }

  if (driver === 'supabase') {
    const url = process.env['FLEEX_SUPABASE_URL'];
    const key = process.env['FLEEX_SUPABASE_KEY'];
    if (!url || !key) return null;
    const { SupabaseConnection } = await import('../adapters/supabase/connection.js');
    const conn = new SupabaseConnection(url, key, process.env['FLEEX_SUPABASE_DB_URL']);
    await conn.init();
    try {
      const { data } = await conn.client
        .from('app_config')
        .select('data')
        .eq('id', 'singleton')
        .maybeSingle();
      return pick((data as { data?: Record<string, unknown> } | null)?.data) ?? DEFAULT_BASE_PATH;
    } finally {
      await conn.close();
    }
  }

  return null;
}

readBasePath()
  .then((basePath) => {
    process.stdout.write(JSON.stringify({ basePath }) + '\n');
    process.exit(0);
  })
  .catch(() => {
    process.stdout.write(JSON.stringify({ basePath: null }) + '\n');
    process.exit(0);
  });
