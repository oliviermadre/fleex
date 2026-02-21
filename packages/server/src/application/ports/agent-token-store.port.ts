import type { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';

export interface AgentTokenStorePort {
  getAll(): Promise<ApiTokenEntity[]>;
  getByHash(hash: string): Promise<ApiTokenEntity | null>;
  save(token: ApiTokenEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
