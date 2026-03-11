import type { Skill } from '@fleex/shared';

export class SkillEntity {
  constructor(
    public readonly id: string,
    public commandName: string,
    public name: string,
    public displayName: string,
    public markdownContent: string,
    public enabled: boolean,
    public personaId: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    commandName: string;
    name: string;
    displayName: string;
    markdownContent?: string;
    enabled?: boolean;
    personaId: string;
  }): SkillEntity {
    const now = new Date();
    return new SkillEntity(
      params.id,
      params.commandName,
      params.name,
      params.displayName,
      params.markdownContent ?? '',
      params.enabled ?? true,
      params.personaId,
      now,
      now,
    );
  }

  update(changes: {
    commandName?: string;
    name?: string;
    displayName?: string;
    markdownContent?: string;
    enabled?: boolean;
    personaId?: string;
  }): void {
    if (changes.commandName !== undefined) this.commandName = changes.commandName;
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.displayName !== undefined) this.displayName = changes.displayName;
    if (changes.markdownContent !== undefined) this.markdownContent = changes.markdownContent;
    if (changes.enabled !== undefined) this.enabled = changes.enabled;
    if (changes.personaId !== undefined) this.personaId = changes.personaId;
    this.updatedAt = new Date();
  }

  toDTO(): Skill {
    return {
      id: this.id,
      commandName: this.commandName,
      name: this.name,
      displayName: this.displayName,
      markdownContent: this.markdownContent,
      enabled: this.enabled,
      personaId: this.personaId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
