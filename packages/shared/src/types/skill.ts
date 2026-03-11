export interface Skill {
  readonly id: string;
  readonly commandName: string;
  readonly name: string;
  readonly displayName: string;
  readonly markdownContent: string;
  readonly enabled: boolean;
  readonly personaId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSkillRequest {
  readonly commandName: string;
  readonly name: string;
  readonly displayName: string;
  readonly markdownContent: string;
  readonly enabled?: boolean;
  readonly personaId: string;
}

export interface UpdateSkillRequest {
  readonly commandName?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly markdownContent?: string;
  readonly enabled?: boolean;
  readonly personaId?: string;
}

export type SkillWsMessageType = 'skill:created' | 'skill:updated' | 'skill:deleted';

export interface SkillWsMessage {
  readonly type: SkillWsMessageType;
  readonly data: unknown;
}
