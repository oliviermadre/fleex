import pg from 'pg';
import type { LoggerPort } from '../../application/ports/logger.port.js';

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
