import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { CommentVisibility } from '@fleex/shared';
import { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';
import type { CommentStorePort } from '../../application/ports/comment-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedComment {
  id: string;
  ticketId: string;
  authorType: 'user' | 'agent';
  authorName: string;
  body: string;
  visibility: CommentVisibility;
  privateRecipients: string[];
  mentions: string[];
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class JsonCommentStore implements CommentStorePort {
  private readonly comments = new Map<string, TicketCommentEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'comments.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getByTicket(ticketId: string): Promise<TicketCommentEntity[]> {
    return Array.from(this.comments.values())
      .filter((c) => c.ticketId === ticketId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getById(id: string): Promise<TicketCommentEntity | null> {
    return this.comments.get(id) ?? null;
  }

  async getAll(): Promise<TicketCommentEntity[]> {
    return Array.from(this.comments.values());
  }

  async save(comment: TicketCommentEntity): Promise<void> {
    this.comments.set(comment.id, comment);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    this.comments.delete(id);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedComment[];
      for (const c of data) {
        this.comments.set(c.id, new TicketCommentEntity(
          c.id, c.ticketId, c.authorType, c.authorName,
          c.body, c.visibility, c.privateRecipients, c.mentions,
          c.parentId, new Date(c.createdAt), new Date(c.updatedAt),
        ));
      }
      this.logger.info('Comment store loaded', { count: this.comments.size });
    } catch (err) {
      this.logger.warn('Failed to load comments from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedComment[] = Array.from(this.comments.values()).map((c) => ({
        id: c.id, ticketId: c.ticketId, authorType: c.authorType,
        authorName: c.authorName, body: c.body, visibility: c.visibility,
        privateRecipients: c.privateRecipients, mentions: c.mentions,
        parentId: c.parentId,
        createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync comments to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
