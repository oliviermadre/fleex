import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { MentionExecutionMode, MentionStatus, MentionTargetType } from '@fleex/shared';
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
  targetType?: MentionTargetType;
  executionMode?: MentionExecutionMode;
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
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'mentions.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getByTicket(ticketId: string): Promise<TicketMentionEntity[]> {
    return Array.from(this.mentions.values())
      .filter((m) => m.ticketId === ticketId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getById(id: string): Promise<TicketMentionEntity | null> {
    return this.mentions.get(id) ?? null;
  }

  async getByIds(ids: string[]): Promise<TicketMentionEntity[]> {
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return Array.from(this.mentions.values()).filter((m) => idSet.has(m.id));
  }

  async getAll(): Promise<TicketMentionEntity[]> {
    return Array.from(this.mentions.values());
  }

  async getByComment(commentId: string): Promise<TicketMentionEntity[]> {
    return Array.from(this.mentions.values()).filter((m) => m.commentId === commentId);
  }

  async getPendingForAgent(agentName: string): Promise<TicketMentionEntity[]> {
    // `failed` is excluded like `resolved`/`waiting_for_info`: a crashed mention
    // must only be relaunched by the user (crash card → runMention), never swept
    // up by the persona-scoped auto-trigger — otherwise a new mention for the same
    // agent would silently re-run a crashed one, looping on an unresolved cause
    // (the "no auto-retry" non-goal, ticket #443).
    return Array.from(this.mentions.values())
      .filter(
        (m) =>
          m.targetAgent === agentName &&
          m.status !== 'resolved' &&
          m.status !== 'waiting_for_info' &&
          m.status !== 'failed',
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getPendingCountForTicket(ticketId: string): Promise<number> {
    return Array.from(this.mentions.values())
      .filter((m) => m.ticketId === ticketId && m.status !== 'resolved')
      .length;
  }

  async getWaitingByTicket(ticketId: string): Promise<TicketMentionEntity[]> {
    return Array.from(this.mentions.values())
      .filter((m) => m.ticketId === ticketId && m.status === 'waiting_for_info')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
          m.targetType ?? 'agent',
          m.executionMode ?? 'plan',
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
        targetType: m.targetType, executionMode: m.executionMode,
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
