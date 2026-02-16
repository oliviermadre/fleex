import type { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';

export interface AgentTokenStorePort {
  getAll(): ApiTokenEntity[];
  getByHash(hash: string): ApiTokenEntity | null;
  save(token: ApiTokenEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
