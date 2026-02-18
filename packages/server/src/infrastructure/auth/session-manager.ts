import { randomBytes } from 'node:crypto';
import type { DbPool } from '../database/db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionData {
  userId: string;
  [key: string]: unknown;
}

export class SessionManager {
  constructor(private readonly pool: DbPool) {}

  async create(userId: string, data: Record<string, unknown> = {}): Promise<string> {
    const sessionId = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.pool.query(
      `INSERT INTO user_sessions (id, user_id, data, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, userId, JSON.stringify(data), expiresAt.toISOString()],
    );

    return sessionId;
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const { rows } = await this.pool.query<{
      user_id: string;
      data: Record<string, unknown>;
      expires_at: string;
    }>(
      'SELECT user_id, data, expires_at FROM user_sessions WHERE id = $1',
      [sessionId],
    );

    if (rows.length === 0) return null;

    const row = rows[0]!;
    if (new Date(row.expires_at) < new Date()) {
      await this.destroy(sessionId);
      return null;
    }

    return { userId: row.user_id, ...row.data };
  }

  async destroy(sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM user_sessions WHERE id = $1', [sessionId]);
  }

  async destroyAllForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
  }

  async cleanup(): Promise<number> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM user_sessions WHERE expires_at < now()',
    );
    return rowCount ?? 0;
  }
}
