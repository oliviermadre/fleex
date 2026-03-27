import type { ExecutionMode, Panel, PanelMember } from '@fleex/shared';

export class PanelEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public displayName: string,
    public description: string,
    public executionMode: ExecutionMode,
    public members: PanelMember[],
    public orchestratorPrompt: string,
    public orchestratorModel: string,
    public orchestratorPersonaId: string | null,
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
    executionMode?: ExecutionMode;
    members: PanelMember[];
    orchestratorPrompt?: string;
    orchestratorModel?: string;
    orchestratorPersonaId?: string | null;
    defaultMemberModel?: string;
    enabled?: boolean;
  }): PanelEntity {
    const now = new Date();
    return new PanelEntity(
      params.id,
      params.name,
      params.displayName,
      params.description ?? '',
      params.executionMode ?? 'claude_code',
      params.members,
      params.orchestratorPrompt ?? '',
      params.orchestratorModel ?? 'claude-sonnet-4-6',
      params.orchestratorPersonaId ?? null,
      params.defaultMemberModel ?? 'claude-sonnet-4-6',
      params.enabled ?? true,
      now,
      now,
    );
  }

  update(changes: {
    name?: string;
    displayName?: string;
    description?: string;
    executionMode?: ExecutionMode;
    members?: PanelMember[];
    orchestratorPrompt?: string;
    orchestratorModel?: string;
    orchestratorPersonaId?: string | null;
    defaultMemberModel?: string;
    enabled?: boolean;
  }): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.displayName !== undefined) this.displayName = changes.displayName;
    if (changes.description !== undefined) this.description = changes.description;
    if (changes.executionMode !== undefined) this.executionMode = changes.executionMode;
    if (changes.members !== undefined) this.members = changes.members;
    if (changes.orchestratorPrompt !== undefined) this.orchestratorPrompt = changes.orchestratorPrompt;
    if (changes.orchestratorModel !== undefined) this.orchestratorModel = changes.orchestratorModel;
    if (changes.orchestratorPersonaId !== undefined) this.orchestratorPersonaId = changes.orchestratorPersonaId;
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
      executionMode: this.executionMode,
      members: this.members,
      orchestratorPrompt: this.orchestratorPrompt,
      orchestratorModel: this.orchestratorModel,
      orchestratorPersonaId: this.orchestratorPersonaId,
      defaultMemberModel: this.defaultMemberModel,
      enabled: this.enabled,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
