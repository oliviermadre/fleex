import type { TicketActivity } from '@fleex/shared';
import { sanitizeForStorageDeep } from '@fleex/shared';

export class TicketActivityEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly action: string,
    public readonly changes: Record<string, { from: unknown; to: unknown }>,
    public readonly actorType: 'user' | 'agent',
    public readonly actorName: string | null,
    public readonly source: 'web' | 'api',
    public readonly createdAt: Date,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    action: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
    actorType?: 'user' | 'agent';
    actorName?: string | null;
    source?: 'web' | 'api';
  }): TicketActivityEntity {
    return new TicketActivityEntity(
      params.id,
      params.ticketId,
      params.action,
      sanitizeForStorageDeep(params.changes ?? {}),
      params.actorType ?? 'user',
      params.actorName ?? null,
      params.source ?? 'web',
      new Date(),
    );
  }

  toDTO(): TicketActivity {
    return {
      id: this.id,
      ticketId: this.ticketId,
      action: this.action,
      changes: this.changes,
      actorType: this.actorType,
      actorName: this.actorName,
      source: this.source,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
