import type { PgConnection } from './connection.js';
import type { KvStorePort } from '../../../application/ports/kv-store.port.js';

export class PgKvStoreAdapter implements KvStorePort {
  constructor(private readonly connection: PgConnection) {}

  async get(key: string): Promise<string | null> {
    const result = await this.connection.query('SELECT value FROM kv_store WHERE key = $1', [key]);
    return result.rows[0]?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.connection.query(
      'INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()',
      [key, value],
    );
  }

  async delete(key: string): Promise<void> {
    await this.connection.query('DELETE FROM kv_store WHERE key = $1', [key]);
  }

  async listByPrefix(prefix: string): Promise<{ key: string; value: string }[]> {
    const result = await this.connection.query(
      'SELECT key, value FROM kv_store WHERE key LIKE $1',
      [`${prefix}%`],
    );
    return result.rows;
  }
}
