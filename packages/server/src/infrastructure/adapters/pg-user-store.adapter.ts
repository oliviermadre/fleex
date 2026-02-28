import type { DbPool } from '../database/db.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: string;
  providerId: string;
  preferences: Record<string, unknown>;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_id: string;
  preferences: Record<string, unknown>;
  created_at: string;
}

export class PgUserStore {
  constructor(
    private readonly pool: DbPool,
    private readonly logger: LoggerPort,
  ) {}

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id],
    ) as { rows: UserRow[] };
    return rows[0] ? this.rowToRecord(rows[0]) : null;
  }

  async findByProvider(provider: string, providerId: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE provider = $1 AND provider_id = $2',
      [provider, providerId],
    ) as { rows: UserRow[] };
    return rows[0] ? this.rowToRecord(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email],
    ) as { rows: UserRow[] };
    return rows[0] ? this.rowToRecord(rows[0]) : null;
  }

  async upsertFromOAuth(params: {
    provider: string;
    providerId: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  }): Promise<UserRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, name, avatar_url, provider, provider_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, provider_id) DO UPDATE SET
         email = $1, name = $2, avatar_url = $3
       RETURNING *`,
      [params.email, params.name, params.avatarUrl, params.provider, params.providerId],
    ) as { rows: UserRow[] };
    this.logger.info('User upserted from OAuth', { provider: params.provider, email: params.email });
    return this.rowToRecord(rows[0]!);
  }

  private rowToRecord(row: UserRow): UserRecord {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
      provider: row.provider,
      providerId: row.provider_id,
      preferences: row.preferences,
      createdAt: new Date(row.created_at),
    };
  }
}
