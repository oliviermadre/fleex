import type { TicketDeliverable, DeliverableType, DeliverableStatus } from '@fleex/shared';

export class TicketDeliverableEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly agentName: string,
    public readonly type: DeliverableType,
    public title: string,
    public content: string,
    public version: number,
    public status: DeliverableStatus,
    public readonly mentionId: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public lastEditedAt: Date | null = null,
    public lastEditedBy: string | null = null,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    agentName: string;
    type: DeliverableType;
    title: string;
    content: string;
    status?: DeliverableStatus;
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
      now,
      now,
    );
  }

  /**
   * Apply changes. Returns whether the title or content (i.e. the actual
   * deliverable payload) changed — a pure status flip does not count as a
   * content edit and does not stamp `lastEditedAt`. `editedBy` is the display
   * name of the editor (may differ from the authoring agent).
   */
  update(changes: { title?: string; content?: string; status?: DeliverableStatus }, editedBy?: string): boolean {
    let contentChanged = false;
    if (changes.content !== undefined && changes.content !== this.content) {
      this.content = changes.content;
      this.version += 1;
      contentChanged = true;
    }
    if (changes.title !== undefined && changes.title !== this.title) {
      this.title = changes.title;
      contentChanged = true;
    }
    if (changes.status !== undefined) {
      this.status = changes.status;
    }
    this.updatedAt = new Date();
    if (contentChanged) {
      this.lastEditedAt = this.updatedAt;
      if (editedBy !== undefined) this.lastEditedBy = editedBy;
    }
    return contentChanged;
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
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      lastEditedAt: this.lastEditedAt?.toISOString() ?? null,
      lastEditedBy: this.lastEditedBy,
    };
  }
}
