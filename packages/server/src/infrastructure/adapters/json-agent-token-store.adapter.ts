import { join } from 'node:path';

import { FLEEX_DIR } from '@fleex/shared';

import { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';

import type { AgentTokenStorePort } from '../../application/ports/agent-token-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedToken {
  id: string;
  name: string;
  prefix: string;
  hashedSecret: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export class JsonAgentTokenStore implements AgentTokenStorePort {
  private readonly tokens = new Map<string, ApiTokenEntity>();
  private readonly hashIndex = new Map<string, string>(); // hash -> id
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'api-tokens.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const dir = join(this.homedir, FLEEX_DIR);
    if (!(await this.hostFs.exists(dir))) {
      await this.hostFs.mkdir(dir);
    }
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getAll(): Promise<ApiTokenEntity[]> {
    return Array.from(this.tokens.values());
  }

  async getByHash(hash: string): Promise<ApiTokenEntity | null> {
    const id = this.hashIndex.get(hash);
    if (!id) return null;
    return this.tokens.get(id) ?? null;
  }

  async save(token: ApiTokenEntity): Promise<void> {
    this.tokens.set(token.id, token);
    this.hashIndex.set(token.hashedSecret, token.id);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    const token = this.tokens.get(id);
    if (token) {
      this.hashIndex.delete(token.hashedSecret);
      this.tokens.delete(id);
      await this.syncToDisk();
    }
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedToken[];
      for (const t of data) {
        const entity = new ApiTokenEntity(
          t.id,
          t.name,
          t.prefix,
          t.hashedSecret,
          t.lastUsedAt ? new Date(t.lastUsedAt) : null,
          new Date(t.createdAt),
        );
        this.tokens.set(entity.id, entity);
        this.hashIndex.set(entity.hashedSecret, entity.id);
      }
      this.logger.info('Agent token store loaded', { count: this.tokens.size });
    } catch (err) {
      this.logger.warn('Failed to load agent token store from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedToken[] = Array.from(this.tokens.values()).map((t) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        hashedSecret: t.hashedSecret,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync agent token store to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
