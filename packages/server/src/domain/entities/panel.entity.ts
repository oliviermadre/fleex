import type { Panel, PanelMember } from '@fleex/shared';

export class PanelEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public displayName: string,
    public description: string,
    public members: PanelMember[],
    public orchestratorPrompt: string,
    public orchestratorModel: string,
    public defaultMemberModel: string,
    public enabled: boolean,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    displayName: string;
    description?: string;
    members: PanelMember[];
    orchestratorPrompt?: string;
    orchestratorModel?: string;
    defaultMemberModel?: string;
    enabled?: boolean;
  }): PanelEntity {
    const now = new Date();
    return new PanelEntity(
      params.id,
      params.name,
      params.displayName,
      params.description ?? '',
      params.members,
      params.orchestratorPrompt ?? '',
      params.orchestratorModel ?? 'claude-sonnet-4-5-20250929',
      params.defaultMemberModel ?? 'claude-sonnet-4-5-20250929',
      params.enabled ?? true,
      now,
      now,
    );
  }

  update(changes: {
    name?: string;
    displayName?: string;
    description?: string;
    members?: PanelMember[];
    orchestratorPrompt?: string;
    orchestratorModel?: string;
    defaultMemberModel?: string;
    enabled?: boolean;
  }): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.displayName !== undefined) this.displayName = changes.displayName;
    if (changes.description !== undefined) this.description = changes.description;
    if (changes.members !== undefined) this.members = changes.members;
    if (changes.orchestratorPrompt !== undefined) this.orchestratorPrompt = changes.orchestratorPrompt;
    if (changes.orchestratorModel !== undefined) this.orchestratorModel = changes.orchestratorModel;
    if (changes.defaultMemberModel !== undefined) this.defaultMemberModel = changes.defaultMemberModel;
    if (changes.enabled !== undefined) this.enabled = changes.enabled;
    this.updatedAt = new Date();
  }

  toDTO(): Panel {
    return {
      id: this.id,
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      members: this.members,
      orchestratorPrompt: this.orchestratorPrompt,
      orchestratorModel: this.orchestratorModel,
      defaultMemberModel: this.defaultMemberModel,
      enabled: this.enabled,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
