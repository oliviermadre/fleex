import { ApiTokenEntity } from '../../../domain/entities/api-token.entity.js';

import type { SqliteConnection } from './connection.js';
import type { AgentTokenStorePort } from '../../../application/ports/agent-token-store.port.js';

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  hashed_secret: string;
  last_used_at: string | null;
  created_at: string;
}

export class SqliteAgentTokenStoreAdapter implements AgentTokenStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getAll(): Promise<ApiTokenEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM api_tokens').all() as TokenRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getByHash(hash: string): Promise<ApiTokenEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM api_tokens WHERE hashed_secret = ?')
      .get(hash) as TokenRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async save(token: ApiTokenEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO api_tokens
        (id, name, prefix, hashed_secret, last_used_at, created_at)
      VALUES
        (@id, @name, @prefix, @hashed_secret, @last_used_at, @created_at)
    `);

    stmt.run({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      hashed_secret: token.hashedSecret,
      last_used_at: token.lastUsedAt?.toISOString() ?? null,
      created_at: token.createdAt.toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
  }

  private toEntity(row: TokenRow): ApiTokenEntity {
    return new ApiTokenEntity(
      row.id,
      row.name,
      row.prefix,
      row.hashed_secret,
      row.last_used_at ? new Date(row.last_used_at) : null,
      new Date(row.created_at),
    );
  }
}
