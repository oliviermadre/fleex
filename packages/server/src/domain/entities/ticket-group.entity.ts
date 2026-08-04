import type { TicketGroup, TicketGroupTimeframe, TicketGroupStatus } from '@fleex/shared';

export class TicketGroupEntity {
  constructor(
    public readonly id: string,
    public boardIds: string[],
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
    boardId?: string;
    boardIds?: string[];
    name: string;
    emoji?: string;
    color?: string;
    description?: string;
    timeframe?: TicketGroupTimeframe;
  }): TicketGroupEntity {
    const now = new Date();
    const boardIds = params.boardIds ?? (params.boardId ? [params.boardId] : []);
    return new TicketGroupEntity(
      params.id,
      boardIds,
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

  /** @deprecated Use boardIds[0] */
  get boardId(): string {
    return this.boardIds[0] ?? '';
  }

  hasBoard(boardId: string): boolean {
    return this.boardIds.includes(boardId);
  }

  addBoard(boardId: string): void {
    if (!this.boardIds.includes(boardId)) {
      this.boardIds.push(boardId);
      this.updatedAt = new Date();
    }
  }

  removeBoard(boardId: string): void {
    if (this.boardIds.length <= 1) {
      throw new Error('Cannot remove the last board from an epic');
    }
    this.boardIds = this.boardIds.filter((id) => id !== boardId);
    this.updatedAt = new Date();
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
  }): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const apply = <K extends 'name' | 'emoji' | 'color' | 'description' | 'timeframe' | 'groupStatus' | 'blocked' | 'favorite'>(
      key: K,
    ): void => {
      const next = changes[key];
      if (next === undefined || next === this[key]) return;
      diff[key] = { from: this[key], to: next };
      (this[key] as unknown) = next;
    };
    apply('name');
    apply('emoji');
    apply('color');
    apply('description');
    apply('timeframe');
    apply('groupStatus');
    apply('blocked');
    apply('favorite');

    // Only a real change moves the clock — a no-op PATCH must stay invisible.
    if (Object.keys(diff).length > 0) this.updatedAt = new Date();
    return diff;
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
      boardIds: this.boardIds,
      boardId: this.boardIds[0] ?? '',
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
