import type { AdapterType, MigrationContext } from './types.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import { MigrationRunner } from './runner.js';
import { allMigrations } from './index.js';

/**
 * Run all pending migrations for the given adapter.
 *
 * - For sqlite: pass the SqliteConnection
 * - For pgsql: pass the PgConnection
 * - For supabase: pass the SupabaseConnection (schema managed externally, but tracking table is maintained)
 * - For json: pass null, provide homedir
 */
export async function runPendingMigrations(
  adapter: AdapterType,
  connection: unknown,
  logger: LoggerPort,
  opts?: { homedir?: string },
): Promise<void> {
  const ctx = buildContext(adapter, connection);
  const runner = new MigrationRunner(adapter, ctx, allMigrations, logger);

  // Set up adapter-specific helpers
  if (adapter === 'json') {
    const { join } = await import('node:path');
    const { FLEEX_DIR } = await import('@fleex/shared');
    const homedir = opts?.homedir ?? (await import('node:os')).homedir();
    const migrationsPath = join(homedir, FLEEX_DIR, 'projects', '_migrations.json');
    runner.setJsonMigrationsPath(migrationsPath);
  }

  if (adapter === 'sqlite') {
    runner.setQueryRowsFn((sql) => {
      const conn = connection as { db: { prepare(sql: string): { all(): unknown[] } } };
      return Promise.resolve(conn.db.prepare(sql).all() as { name: string }[]);
    });
  }

  if (adapter === 'pgsql' || adapter === 'supabase') {
    if (adapter === 'pgsql') {
      runner.setQueryRowsFn(async (sql) => {
        const conn = connection as { query(text: string): Promise<{ rows: { name: string }[] }> };
        const result = await conn.query(sql);
        return result.rows;
      });
    } else {
      // Supabase: use the client to query the _migrations table
      runner.setQueryRowsFn(async (_sql) => {
        const conn = connection as { client: { from(table: string): { select(cols: string): { order(col: string): Promise<{ data: { name: string }[] | null; error: unknown }> } } } };
        const { data, error } = await conn.client
          .from('_migrations')
          .select('name')
          .order('name');
        if (error) return [];
        return data ?? [];
      });
    }
  }

  await runner.migrate();
}

function buildContext(adapter: AdapterType, connection: unknown): MigrationContext {
  const ctx: MigrationContext = {
    adapter,
    async exec(sql: string): Promise<void> {
      if (adapter === 'sqlite') {
        const conn = connection as { db: { exec(sql: string): void } };
        conn.db.exec(sql);
      } else if (adapter === 'pgsql') {
        const conn = connection as { query(text: string): Promise<unknown> };
        await conn.query(sql);
      } else if (adapter === 'supabase') {
        // Supabase DDL must be run via SQL editor — we use rpc if available, otherwise skip
        // For tracking table operations, we use the client directly
        const conn = connection as { query?(text: string): Promise<unknown>; client: { rpc(fn: string, params: Record<string, unknown>): Promise<{ error: unknown }> } };
        if (conn.query) {
          await conn.query(sql);
        }
        // If no query method, DDL is managed externally (Supabase SQL Editor)
      } else if (adapter === 'json') {
        // JSON adapter: exec is a no-op (JSON migrations handle their own file I/O)
      }
    },
    dialect(variants) {
      return variants[adapter] ?? null;
    },
  };
  return ctx;
}
