import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import { DomainEventLogEntity } from '../../domain/entities/domain-event-log.entity.js';
import type { DomainEventLogStorePort } from '../../application/ports/domain-event-log-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedEntry {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  instanceId: string;
  occurredAt: string;
}

export class JsonDomainEventLogStore implements DomainEventLogStorePort {
  private entries: DomainEventLogEntity[] = [];
  private readonly filePath: string;
  private initialized = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'domain-event-log.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async save(entry: DomainEventLogEntity): Promise<void> {
    this.entries.push(entry);
    this.debouncedSync();
  }

  async list(params: {
    limit: number;
    before?: string;
    eventType?: string;
    instanceId?: string;
    since?: Date;
    until?: Date;
  }): Promise<DomainEventLogEntity[]> {
    let result = [...this.entries].reverse(); // newest first

    if (params.before) {
      const idx = result.findIndex((e) => e.id === params.before);
      if (idx >= 0) result = result.slice(idx + 1);
    }

    if (params.eventType) {
      const prefix = params.eventType;
      result = result.filter((e) =>
        e.eventType === prefix || e.eventType.startsWith(prefix + '.') || e.eventType.startsWith(prefix),
      );
    }

    if (params.instanceId) {
      result = result.filter((e) => e.instanceId === params.instanceId);
    }

    if (params.since) {
      const since = params.since.getTime();
      result = result.filter((e) => e.occurredAt.getTime() >= since);
    }

    if (params.until) {
      const until = params.until.getTime();
      result = result.filter((e) => e.occurredAt.getTime() <= until);
    }

    return result.slice(0, params.limit);
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const cutoff = date.getTime();
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.occurredAt.getTime() >= cutoff);
    const deleted = before - this.entries.length;
    if (deleted > 0) await this.syncToDisk();
    return deleted;
  }

  private debouncedSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncToDisk().catch((err) => {
        this.logger.warn('Failed to sync domain event log to disk', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 500);
  }

  private async syncToDisk(): Promise<void> {
    const data: SerializedEntry[] = this.entries.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      payload: e.payload,
      instanceId: e.instanceId,
      occurredAt: e.occurredAt.toISOString(),
    }));
    await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedEntry[];
      for (const e of data) {
        this.entries.push(
          new DomainEventLogEntity(e.id, e.eventType, e.payload, e.instanceId, new Date(e.occurredAt)),
        );
      }
      this.logger.info('Domain event log loaded', { count: this.entries.length });
    } catch (err) {
      this.logger.warn('Failed to load domain event log from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
