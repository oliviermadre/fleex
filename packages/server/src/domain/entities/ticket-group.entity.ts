import type { TicketGroup, TicketGroupTimeframe, TicketGroupStatus } from '@fleex/shared';

export class TicketGroupEntity {
  constructor(
    public readonly id: string,
    public boardId: string,
    public name: string,
    public emoji: string,
    public color: string,
    public description: string,
    public timeframe: TicketGroupTimeframe,
    public groupStatus: TicketGroupStatus,
    public blocked: boolean,
    public favorite: boolean,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    boardId: string;
    name: string;
    emoji?: string;
    color?: string;
    description?: string;
    timeframe?: TicketGroupTimeframe;
  }): TicketGroupEntity {
    const now = new Date();
    return new TicketGroupEntity(
      params.id,
      params.boardId,
      params.name,
      params.emoji ?? '📌',
      params.color ?? 'fleex-purple',
      params.description ?? '',
      params.timeframe ?? 'now',
      'active',
      false,
      false,
      now,
      now,
    );
  }

  update(changes: {
    name?: string;
    emoji?: string;
    color?: string;
    description?: string;
    timeframe?: TicketGroupTimeframe;
    groupStatus?: TicketGroupStatus;
    blocked?: boolean;
    favorite?: boolean;
  }): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.emoji !== undefined) this.emoji = changes.emoji;
    if (changes.color !== undefined) this.color = changes.color;
    if (changes.description !== undefined) this.description = changes.description;
    if (changes.timeframe !== undefined) this.timeframe = changes.timeframe;
    if (changes.groupStatus !== undefined) this.groupStatus = changes.groupStatus;
    if (changes.blocked !== undefined) this.blocked = changes.blocked;
    if (changes.favorite !== undefined) this.favorite = changes.favorite;
    this.updatedAt = new Date();
  }

  archive(): void {
    if (this.groupStatus !== 'done' && this.groupStatus !== 'cancelled') {
      throw new Error('Can only archive done or cancelled epics');
    }
    this.groupStatus = 'archived';
    this.updatedAt = new Date();
  }

  unarchive(): void {
    if (this.groupStatus !== 'archived') {
      throw new Error('Can only unarchive archived epics');
    }
    this.groupStatus = 'active';
    this.updatedAt = new Date();
  }

  toDTO(): TicketGroup {
    return {
      id: this.id,
      boardId: this.boardId,
      name: this.name,
      emoji: this.emoji,
      color: this.color,
      description: this.description,
      timeframe: this.timeframe,
      groupStatus: this.groupStatus,
      blocked: this.blocked,
      favorite: this.favorite,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
