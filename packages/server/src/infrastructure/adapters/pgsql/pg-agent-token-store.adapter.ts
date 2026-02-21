import { ApiTokenEntity } from '../../../domain/entities/api-token.entity.js';
import type { AgentTokenStorePort } from '../../../application/ports/agent-token-store.port.js';
import type { PgConnection } from './connection.js';

export class PgAgentTokenStore implements AgentTokenStorePort {
  constructor(private readonly db: PgConnection) {}

  async getAll(): Promise<ApiTokenEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM api_tokens');
    return rows.map(rowToToken);
  }

  async getByHash(hash: string): Promise<ApiTokenEntity | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM api_tokens WHERE hashed_secret = $1',
      [hash],
    );
    return rows.length > 0 ? rowToToken(rows[0]) : null;
  }

  async save(token: ApiTokenEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO api_tokens (id, name, prefix, hashed_secret, last_used_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         name = $2,
         prefix = $3,
         hashed_secret = $4,
         last_used_at = $5,
         created_at = $6`,
      [
        token.id,
        token.name,
        token.prefix,
        token.hashedSecret,
        token.lastUsedAt?.toISOString() ?? null,
        token.createdAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM api_tokens WHERE id = $1', [id]);
  }
}

function rowToToken(row: Record<string, unknown>): ApiTokenEntity {
  return new ApiTokenEntity(
    row.id as string,
    row.name as string,
    row.prefix as string,
    row.hashed_secret as string,
    row.last_used_at ? new Date(row.last_used_at as string) : null,
    new Date(row.created_at as string),
  );
}
