import { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';
import type { AgentTokenStorePort } from '../../application/ports/agent-token-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { DbPool } from '../database/db.js';

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  hashed_secret: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

export class PgAgentTokenStore implements AgentTokenStorePort {
  private readonly tokens = new Map<string, ApiTokenEntity>();
  private readonly hashIndex = new Map<string, string>(); // hash -> id

  constructor(
    private readonly pool: DbPool,
    private readonly userId: string,
    private readonly logger: LoggerPort,
  ) {}

  async init(): Promise<void> {
    const { rows } = await this.pool.query<TokenRow>(
      'SELECT * FROM api_tokens WHERE user_id = $1',
      [this.userId],
    );
    for (const row of rows) {
      const entity = new ApiTokenEntity(
        row.id, row.name, row.prefix, row.hashed_secret,
        row.last_used_at ? new Date(row.last_used_at) : null,
        new Date(row.created_at),
      );
      this.tokens.set(entity.id, entity);
      this.hashIndex.set(entity.hashedSecret, entity.id);
    }
    this.logger.info('PgAgentTokenStore loaded', { count: this.tokens.size });
  }

  getAll(): ApiTokenEntity[] {
    return Array.from(this.tokens.values());
  }

  getByHash(hash: string): ApiTokenEntity | null {
    const id = this.hashIndex.get(hash);
    if (!id) return null;
    return this.tokens.get(id) ?? null;
  }

  async save(token: ApiTokenEntity): Promise<void> {
    await this.pool.query(
      `INSERT INTO api_tokens (id, user_id, name, prefix, hashed_secret, last_used_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET name = $3, last_used_at = $6`,
      [token.id, this.userId, token.name, token.prefix, token.hashedSecret,
       token.lastUsedAt?.toISOString() ?? null, token.createdAt.toISOString()],
    );
    this.tokens.set(token.id, token);
    this.hashIndex.set(token.hashedSecret, token.id);
  }

  async remove(id: string): Promise<void> {
    const token = this.tokens.get(id);
    if (token) {
      await this.pool.query(
        'DELETE FROM api_tokens WHERE id = $1 AND user_id = $2',
        [id, this.userId],
      );
      this.hashIndex.delete(token.hashedSecret);
      this.tokens.delete(id);
    }
  }
}
