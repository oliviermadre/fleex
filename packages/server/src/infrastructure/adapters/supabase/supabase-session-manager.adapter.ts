import { randomBytes } from 'node:crypto';

import type { SupabaseConnection } from './connection.js';
import type { SessionData } from '../../auth/session-manager.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionRow {
  id: string;
  user_id: string;
  data: Record<string, unknown>;
  expires_at: string;
}

export class SupabaseSessionManager {
  constructor(private readonly conn: SupabaseConnection) {}

  async create(userId: string, data: Record<string, unknown> = {}): Promise<string> {
    const sessionId = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const { error } = await this.conn.client.from('user_sessions').insert({
      id: sessionId,
      user_id: userId,
      data,
      expires_at: expiresAt,
    });
    if (error) throw new Error(`SupabaseSessionManager.create failed: ${error.message}`);
    return sessionId;
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const { data, error } = await this.conn.client
      .from('user_sessions')
      .select('user_id, data, expires_at')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw new Error(`SupabaseSessionManager.get failed: ${error.message}`);
    if (!data) return null;

    const row = data as SessionRow;
    if (new Date(row.expires_at) < new Date()) {
      await this.destroy(sessionId);
      return null;
    }

    return { userId: row.user_id, ...row.data };
  }

  async destroy(sessionId: string): Promise<void> {
    const { error } = await this.conn.client.from('user_sessions').delete().eq('id', sessionId);
    if (error) throw new Error(`SupabaseSessionManager.destroy failed: ${error.message}`);
  }

  async destroyAllForUser(userId: string): Promise<void> {
    const { error } = await this.conn.client.from('user_sessions').delete().eq('user_id', userId);
    if (error) throw new Error(`SupabaseSessionManager.destroyAllForUser failed: ${error.message}`);
  }

  async cleanup(): Promise<number> {
    const now = new Date().toISOString();
    const { data, error } = await this.conn.client
      .from('user_sessions')
      .delete()
      .lt('expires_at', now)
      .select('id');
    if (error) throw new Error(`SupabaseSessionManager.cleanup failed: ${error.message}`);
    return data?.length ?? 0;
  }
}
