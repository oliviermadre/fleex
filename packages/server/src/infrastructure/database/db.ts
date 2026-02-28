import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoggerPort } from '../../application/ports/logger.port.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DbPool = pg.Pool & {
  connect(): Promise<{ query(text: string, params?: unknown[]): Promise<{ rows: any[] }>; release(): void }>;
};

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

export function getDefaultUserId(): string {
  return DEFAULT_USER_ID;
}

export async function createDbPool(logger: LoggerPort): Promise<DbPool> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for PostgreSQL mode');
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  } as any) as DbPool;

  // Verify connectivity
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('PostgreSQL connected', { host: new URL(databaseUrl).hostname });
  } finally {
    client.release();
  }

  return pool;
}

export async function runMigrations(pool: DbPool, logger: LoggerPort): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure _migrations table exists (bootstrap)
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Read migration files sorted by name
    const migrationsDir = join(__dirname, 'migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [file],
      );
      if (rows.length > 0) continue;

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      logger.info('Applying migration', { name: file });

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (name) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        logger.info('Migration applied', { name: file });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
