import { join } from 'node:path';
import { ASM_DIR } from '@asm/shared';
import type { MentionStatus } from '@asm/shared';
import { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import type { MentionStorePort } from '../../application/ports/mention-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedMention {
  id: string;
  ticketId: string;
  commentId: string;
  targetAgent: string;
  sourceAgent: string;
  status: MentionStatus;
  resolvedAt: string | null;
  resolvedCommentId: string | null;
  resolvedDeliverableId: string | null;
  createdAt: string;
}

export class JsonMentionStore implements MentionStorePort {
  private readonly mentions = new Map<string, TicketMentionEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, ASM_DIR, 'projects', 'mentions.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  getByTicket(ticketId: string): TicketMentionEntity[] {
    return Array.from(this.mentions.values())
      .filter((m) => m.ticketId === ticketId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  getById(id: string): TicketMentionEntity | null {
    return this.mentions.get(id) ?? null;
  }

  getByComment(commentId: string): TicketMentionEntity[] {
    return Array.from(this.mentions.values()).filter((m) => m.commentId === commentId);
  }

  getPendingForAgent(agentName: string): TicketMentionEntity[] {
    return Array.from(this.mentions.values())
      .filter((m) => m.targetAgent === agentName && m.status !== 'resolved')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  getPendingCountForTicket(ticketId: string): number {
    return Array.from(this.mentions.values())
      .filter((m) => m.ticketId === ticketId && m.status !== 'resolved')
      .length;
  }

  async save(mention: TicketMentionEntity): Promise<void> {
    this.mentions.set(mention.id, mention);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    this.mentions.delete(id);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedMention[];
      for (const m of data) {
        this.mentions.set(m.id, new TicketMentionEntity(
          m.id, m.ticketId, m.commentId, m.targetAgent, m.sourceAgent,
          m.status, m.resolvedAt ? new Date(m.resolvedAt) : null,
          m.resolvedCommentId, m.resolvedDeliverableId,
          new Date(m.createdAt),
        ));
      }
      this.logger.info('Mention store loaded', { count: this.mentions.size });
    } catch (err) {
      this.logger.warn('Failed to load mentions from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedMention[] = Array.from(this.mentions.values()).map((m) => ({
        id: m.id, ticketId: m.ticketId, commentId: m.commentId,
        targetAgent: m.targetAgent, sourceAgent: m.sourceAgent,
        status: m.status, resolvedAt: m.resolvedAt?.toISOString() ?? null,
        resolvedCommentId: m.resolvedCommentId,
        resolvedDeliverableId: m.resolvedDeliverableId,
        createdAt: m.createdAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync mentions to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
