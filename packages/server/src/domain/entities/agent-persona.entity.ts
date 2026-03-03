import type { AgentPersona } from '@asm/shared';

export class AgentPersonaEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public displayName: string,
    public model: string,
    public soulMd: string,
    public identityMd: string,
    public memoryMd: string,
    public humanMentionName: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    displayName: string;
    model?: string;
    soulMd?: string;
    identityMd?: string;
    memoryMd?: string;
    humanMentionName?: string | null;
  }): AgentPersonaEntity {
    const now = new Date();
    return new AgentPersonaEntity(
      params.id,
      params.name,
      params.displayName,
      params.model ?? 'claude-sonnet-4-6',
      params.soulMd ?? '',
      params.identityMd ?? '',
      params.memoryMd ?? '',
      params.humanMentionName ?? null,
      now,
      now,
    );
  }

  update(changes: {
    name?: string;
    displayName?: string;
    model?: string;
    soulMd?: string;
    identityMd?: string;
    memoryMd?: string;
    humanMentionName?: string | null;
  }): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.displayName !== undefined) this.displayName = changes.displayName;
    if (changes.model !== undefined) this.model = changes.model;
    if (changes.soulMd !== undefined) this.soulMd = changes.soulMd;
    if (changes.identityMd !== undefined) this.identityMd = changes.identityMd;
    if (changes.memoryMd !== undefined) this.memoryMd = changes.memoryMd;
    if (changes.humanMentionName !== undefined) this.humanMentionName = changes.humanMentionName;
    this.updatedAt = new Date();
  }

  toDTO(): AgentPersona {
    return {
      id: this.id,
      name: this.name,
      displayName: this.displayName,
      model: this.model,
      soulMd: this.soulMd,
      identityMd: this.identityMd,
      memoryMd: this.memoryMd,
      humanMentionName: this.humanMentionName,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
