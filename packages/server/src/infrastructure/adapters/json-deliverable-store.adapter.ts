import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedDeliverable {
  id: string;
  ticketId: string;
  agentName: string;
  type: string;
  title: string;
  content: string;
  version: number;
  status: 'draft' | 'final';
  mentionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class JsonDeliverableStore implements DeliverableStorePort {
  private readonly deliverables = new Map<string, TicketDeliverableEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'deliverables.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.loadFromDisk();
      this.initialized = true;
    } catch {
      // Gateway tunnel may not be connected yet — will retry on next operation.
    }
  }

  async getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]> {
    return Array.from(this.deliverables.values())
      .filter((d) => d.ticketId === ticketId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getById(id: string): Promise<TicketDeliverableEntity | null> {
    return this.deliverables.get(id) ?? null;
  }

  async getAll(): Promise<TicketDeliverableEntity[]> {
    return Array.from(this.deliverables.values());
  }

  async save(deliverable: TicketDeliverableEntity): Promise<void> {
    this.deliverables.set(deliverable.id, deliverable);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedDeliverable[];
      for (const d of data) {
        this.deliverables.set(d.id, new TicketDeliverableEntity(
          d.id, d.ticketId, d.agentName, d.type, d.title,
          d.content, d.version, d.status, d.mentionId,
          new Date(d.createdAt), new Date(d.updatedAt),
        ));
      }
      this.logger.info('Deliverable store loaded', { count: this.deliverables.size });
    } catch (err) {
      this.logger.warn('Failed to load deliverables from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedDeliverable[] = Array.from(this.deliverables.values()).map((d) => ({
        id: d.id, ticketId: d.ticketId, agentName: d.agentName,
        type: d.type, title: d.title, content: d.content,
        version: d.version, status: d.status, mentionId: d.mentionId,
        createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync deliverables to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
