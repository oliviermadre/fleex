import { randomBytes } from 'node:crypto';
import type { SessionData } from '../../src/infrastructure/auth/session-manager.js';
import type { UserRecord } from '../../src/infrastructure/adapters/pg-user-store.adapter.js';

/** In-memory stand-in for the Postgres/Supabase SessionManager. */
export class FakeSessionManager {
  private readonly sessions = new Map<string, SessionData>();

  async create(userId: string, data: Record<string, unknown> = {}): Promise<string> {
    const id = randomBytes(16).toString('hex');
    this.sessions.set(id, { userId, ...data });
    return id;
  }

  async get(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async destroy(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async destroyAllForUser(userId: string): Promise<void> {
    for (const [id, data] of this.sessions) {
      if (data.userId === userId) this.sessions.delete(id);
    }
  }

  async cleanup(): Promise<number> {
    return 0;
  }
}

/** In-memory stand-in for PgUserStore — only what auth.routes.ts touches. */
export class FakeUserStore {
  private readonly users = new Map<string, UserRecord>();

  seed(user: Partial<UserRecord> & { id: string }): UserRecord {
    const record: UserRecord = {
      email: `${user.id}@example.test`,
      name: null,
      avatarUrl: null,
      provider: 'github',
      providerId: user.id,
      preferences: {},
      createdAt: new Date(),
      ...user,
    };
    this.users.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findByProvider(provider: string, providerId: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.provider === provider && u.providerId === providerId) return u;
    }
    return null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return u;
    }
    return null;
  }

  async upsertFromOAuth(params: {
    provider: string;
    providerId: string;
    email: string;
    name: string | null;
    avatarUrl?: string | null;
  }): Promise<UserRecord> {
    const existing = await this.findByProvider(params.provider, params.providerId);
    if (existing) return existing;
    return this.seed({
      id: randomBytes(8).toString('hex'),
      email: params.email,
      name: params.name,
      avatarUrl: params.avatarUrl ?? null,
      provider: params.provider,
      providerId: params.providerId,
    });
  }

  async updatePreferences(id: string, preferences: Record<string, unknown>): Promise<void> {
    const user = this.users.get(id);
    if (user) this.users.set(id, { ...user, preferences });
  }
}
