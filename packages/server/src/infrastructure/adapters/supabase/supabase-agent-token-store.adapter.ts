import { ApiTokenEntity } from '../../../domain/entities/api-token.entity.js';
import type { AgentTokenStorePort } from '../../../application/ports/agent-token-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  hashed_secret: string;
  last_used_at: string | null;
  created_at: string;
}

function rowToEntity(r: ApiTokenRow): ApiTokenEntity {
  return new ApiTokenEntity(
    r.id,
    r.name,
    r.prefix,
    r.hashed_secret,
    r.last_used_at ? new Date(r.last_used_at) : null,
    new Date(r.created_at),
  );
}

export class SupabaseAgentTokenStore implements AgentTokenStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getAll(): Promise<ApiTokenEntity[]> {
    const { data, error } = await this.conn.client
      .from('api_tokens')
      .select('*');
    if (error) throw new Error(`SupabaseAgentTokenStore.getAll failed: ${error.message}`);
    return (data as ApiTokenRow[]).map(rowToEntity);
  }

  async getByHash(hash: string): Promise<ApiTokenEntity | null> {
    const { data, error } = await this.conn.client
      .from('api_tokens')
      .select('*')
      .eq('hashed_secret', hash)
      .maybeSingle();
    if (error) throw new Error(`SupabaseAgentTokenStore.getByHash failed: ${error.message}`);
    return data ? rowToEntity(data as ApiTokenRow) : null;
  }

  async save(token: ApiTokenEntity): Promise<void> {
    const { error } = await this.conn.client.from('api_tokens').upsert({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      hashed_secret: token.hashedSecret,
      last_used_at: token.lastUsedAt?.toISOString() ?? null,
      created_at: token.createdAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseAgentTokenStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('api_tokens')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseAgentTokenStore.remove failed: ${error.message}`);
  }
}
