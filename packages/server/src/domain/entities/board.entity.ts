import type { Board } from '@fleex/shared';

export class BoardEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public emoji: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    emoji?: string;
  }): BoardEntity {
    const now = new Date();
    return new BoardEntity(
      params.id,
      params.name,
      params.emoji ?? '📋',
      now,
      now,
    );
  }

  update(changes: { name?: string; emoji?: string }): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.emoji !== undefined) this.emoji = changes.emoji;
    this.updatedAt = new Date();
  }

  toDTO(): Board {
    return {
      id: this.id,
      name: this.name,
      emoji: this.emoji,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
