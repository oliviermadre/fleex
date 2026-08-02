import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

export class JsonKvStore implements KvStorePort {
  private readonly entries = new Map<string, string>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'kv.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    await this.syncToDisk();
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
    await this.syncToDisk();
  }

  async listByPrefix(prefix: string): Promise<{ key: string; value: string }[]> {
    const out: { key: string; value: string }[] = [];
    for (const [key, value] of this.entries) {
      if (key.startsWith(prefix)) out.push({ key, value });
    }
    return out;
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [key, value] of Object.entries(data)) {
        this.entries.set(key, value);
      }
      this.logger.info('KV store loaded', { count: this.entries.size });
    } catch (err) {
      this.logger.warn('Failed to load KV store from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data = Object.fromEntries(this.entries);
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync KV store to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
