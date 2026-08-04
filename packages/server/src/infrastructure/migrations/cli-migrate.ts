#!/usr/bin/env bun
/**
 * CLI entrypoint for running migrations.
 *
 * Usage:
 *   bun run packages/server/src/infrastructure/migrations/cli-migrate.ts [migrate|rollback]
 *
 * Environment variables:
 *   FLEEX_STORAGE_DRIVER  - sqlite | pgsql | supabase (default: sqlite)
 *   FLEEX_SQLITE_PATH     - Path to SQLite database file
 *   FLEEX_PGSQL_URL       - PostgreSQL connection URL
 *   FLEEX_SUPABASE_URL    - Supabase URL
 *   FLEEX_SUPABASE_KEY    - Supabase service role key
 *   FLEEX_SUPABASE_DB_URL - Supabase direct PostgreSQL connection string (required for migrations)
 */

import type { AdapterType } from './types.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

const rawDriver = process.env['FLEEX_STORAGE_DRIVER']?.toLowerCase() ?? 'sqlite';
const validDrivers: AdapterType[] = ['sqlite', 'pgsql', 'supabase'];
if (!validDrivers.includes(rawDriver as AdapterType)) {
  // Without this guard an unknown value matches no branch, leaves the connection
  // null, and surfaces much later as "queryRowsFn not set on MigrationRunner".
  console.error(
    `[migrate] ERROR: Invalid FLEEX_STORAGE_DRIVER="${rawDriver}". Must be one of: ${validDrivers.join(', ')}`,
  );
  process.exit(1);
}
const driver = rawDriver as AdapterType;
const command = process.argv[2] ?? 'migrate';

// Simple console logger for CLI usage
const logger: LoggerPort = {
  info(msg: string, meta?: Record<string, unknown>) {
    console.log(`[migrate] ${msg}`, meta ? JSON.stringify(meta) : '');
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    console.warn(`[migrate] WARN: ${msg}`, meta ? JSON.stringify(meta) : '');
  },
  error(msg: string, meta?: Record<string, unknown>) {
    console.error(`[migrate] ERROR: ${msg}`, meta ? JSON.stringify(meta) : '');
  },
  debug(msg: string, meta?: Record<string, unknown>) {
    console.log(`[migrate] DEBUG: ${msg}`, meta ? JSON.stringify(meta) : '');
  },
} as LoggerPort;

async function main() {
  const { runPendingMigrations } = await import('./run-migrations.js');

  let connection: unknown = null;

  if (driver === 'sqlite') {
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { FLEEX_DIR } = await import('@fleex/shared');
    const { SqliteConnection } = await import('../adapters/sqlite/connection.js');

    const dbPath = process.env['FLEEX_SQLITE_PATH'] ?? join(homedir(), FLEEX_DIR, 'fleex.db');
    const conn = new SqliteConnection(dbPath);
    await conn.init();
    connection = conn;
  } else if (driver === 'pgsql') {
    const url = process.env['FLEEX_PGSQL_URL'];
    if (!url) {
      console.error('FLEEX_PGSQL_URL is required when FLEEX_STORAGE_DRIVER=pgsql');
      process.exit(1);
    }
    const { PgConnection } = await import('../adapters/pgsql/connection.js');
    const conn = new PgConnection(url);
    await conn.init();
    connection = conn;
  } else if (driver === 'supabase') {
    const url = process.env['FLEEX_SUPABASE_URL'];
    const key = process.env['FLEEX_SUPABASE_KEY'];
    if (!url || !key) {
      console.error('FLEEX_SUPABASE_URL and FLEEX_SUPABASE_KEY are required');
      process.exit(1);
    }
    const dbUrl = process.env['FLEEX_SUPABASE_DB_URL'];
    if (!dbUrl) {
      logger.warn('FLEEX_SUPABASE_DB_URL is not set — migrations require a direct PostgreSQL connection to Supabase.');
      logger.warn('Set FLEEX_SUPABASE_DB_URL to your Supabase PostgreSQL connection string (found in Supabase Dashboard > Settings > Database).');
    }
    const { SupabaseConnection } = await import('../adapters/supabase/connection.js');
    const conn = new SupabaseConnection(url, key, dbUrl);
    await conn.init();
    connection = conn;
  }

  if (command === 'migrate') {
    await runPendingMigrations(driver, connection, logger);
  } else if (command === 'rollback') {
    const { MigrationRunner } = await import('./runner.js');
    const { allMigrations } = await import('./index.js');
    // For rollback, we need to build the full runner — reuse the same wiring
    // For now, just run the standard migrate path (rollback is manual/advanced)
    logger.warn('Rollback via CLI is not yet fully implemented. Use with caution.');
    await runPendingMigrations(driver, connection, logger);
  } else {
    console.error(`Unknown command: ${command}. Use 'migrate' or 'rollback'.`);
    process.exit(1);
  }

  // Close connections
  if (driver === 'sqlite' && connection) {
    (connection as { close(): void }).close();
  } else if ((driver === 'pgsql' || driver === 'supabase') && connection) {
    await (connection as { close(): Promise<void> }).close();
  }

  logger.info('Done.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
