import type { TicketDeliverable } from '@fleex/shared';

export class TicketDeliverableEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly agentName: string,
    public readonly type: string,
    public title: string,
    public content: string,
    public version: number,
    public status: 'draft' | 'final',
    public readonly mentionId: string | null,
    public excludedFromContext: boolean,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    agentName: string;
    type: string;
    title: string;
    content: string;
    status?: 'draft' | 'final';
    mentionId?: string | null;
  }): TicketDeliverableEntity {
    const now = new Date();
    return new TicketDeliverableEntity(
      params.id,
      params.ticketId,
      params.agentName,
      params.type,
      params.title,
      params.content,
      1,
      params.status ?? 'draft',
      params.mentionId ?? null,
      false,
      now,
      now,
    );
  }

  update(changes: { title?: string; content?: string; status?: 'draft' | 'final'; excludedFromContext?: boolean }): void {
    if (changes.content !== undefined && changes.content !== this.content) {
      this.content = changes.content;
      this.version += 1;
    }
    if (changes.title !== undefined) {
      this.title = changes.title;
    }
    if (changes.status !== undefined) {
      this.status = changes.status;
    }
    if (changes.excludedFromContext !== undefined) {
      this.excludedFromContext = changes.excludedFromContext;
    }
    this.updatedAt = new Date();
  }

  isOwnedBy(agentName: string): boolean {
    return this.agentName === agentName;
  }

  toDTO(): TicketDeliverable {
    return {
      id: this.id,
      ticketId: this.ticketId,
      agentName: this.agentName,
      type: this.type,
      title: this.title,
      content: this.content,
      version: this.version,
      status: this.status,
      mentionId: this.mentionId,
      excludedFromContext: this.excludedFromContext,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
