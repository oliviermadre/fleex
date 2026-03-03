import type { Board } from '@asm/shared';

export class BoardEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public emoji: string,
    public readonly repositoryOrg: string | null,
    public readonly repositoryName: string | null,
    public nextDisplayId: number,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    emoji?: string;
    repositoryOrg?: string | null;
    repositoryName?: string | null;
  }): BoardEntity {
    const now = new Date();
    return new BoardEntity(
      params.id,
      params.name,
      params.emoji ?? '📋',
      params.repositoryOrg ?? null,
      params.repositoryName ?? null,
      1,
      now,
      now,
    );
  }

  incrementDisplayId(): number {
    const id = this.nextDisplayId;
    this.nextDisplayId++;
    this.updatedAt = new Date();
    return id;
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
      repositoryOrg: this.repositoryOrg,
      repositoryName: this.repositoryName,
      nextDisplayId: this.nextDisplayId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
