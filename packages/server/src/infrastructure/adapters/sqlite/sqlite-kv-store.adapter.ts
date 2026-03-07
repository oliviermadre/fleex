import type { KvStorePort } from '../../../application/ports/kv-store.port.js';
import type { SqliteConnection } from './connection.js';

export class SqliteKvStoreAdapter implements KvStorePort {
  constructor(private readonly connection: SqliteConnection) {}

  async get(key: string): Promise<string | null> {
    const row = this.connection.db
      .prepare('SELECT value FROM kv_store WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.connection.db
      .prepare(
        'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, value, new Date().toISOString());
  }

  async delete(key: string): Promise<void> {
    this.connection.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
  }

  async listByPrefix(prefix: string): Promise<{ key: string; value: string }[]> {
    const rows = this.connection.db
      .prepare('SELECT key, value FROM kv_store WHERE key LIKE ? || \'%\'')
      .all(prefix) as { key: string; value: string }[];
    return rows;
  }
}
