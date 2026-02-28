import type { DbPool } from '../database/db.js';

/**
 * Simple key-value store backed by the user_kv table.
 * Used for scratchpads, user preferences, and other unstructured data.
 */
export class PgKvStore {
  constructor(
    private readonly pool: DbPool,
    private readonly userId: string,
  ) {}

  async get(key: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      'SELECT value FROM user_kv WHERE user_id = $1 AND key = $2',
      [this.userId, key],
    ) as { rows: { value: unknown }[] };
    if (rows.length === 0) return null;
    const val = rows[0]!.value;
    return typeof val === 'string' ? val : JSON.stringify(val);
  }

  async set(key: string, value: string): Promise<void> {
    // Store as JSONB — wrap plain strings in quotes
    const jsonbValue = JSON.stringify(value);
    await this.pool.query(
      `INSERT INTO user_kv (user_id, key, value, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3::jsonb, updated_at = now()`,
      [this.userId, key, jsonbValue],
    );
  }

  async delete(key: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM user_kv WHERE user_id = $1 AND key = $2',
      [this.userId, key],
    );
  }

  async listByPrefix(prefix: string): Promise<{ key: string; value: string }[]> {
    const { rows } = await this.pool.query(
      'SELECT key, value FROM user_kv WHERE user_id = $1 AND key LIKE $2',
      [this.userId, prefix + '%'],
    ) as { rows: { key: string; value: unknown }[] };
    return rows.map((r) => ({
      key: r.key,
      value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value),
    }));
  }
}
