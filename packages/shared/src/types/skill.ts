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
  /** Absent or 'fleex' for native skills; 'claude_code' for a mirrored SKILL.md. */
  readonly source?: SkillSource;
  /** Claude Code skills only. */
  readonly ccOrigin?: ClaudeCodeSkillOrigin;
  /** Claude Code skills only: the name Claude Code itself uses (`superpowers:brainstorming`). */
  readonly nativeName?: string;
  /** Claude Code `project` skills only: `org/name` of the repo that ships it. */
  readonly repo?: string | null;
  /** Claude Code skills only: frontmatter description. */
  readonly description?: string;
  /** Claude Code skills only: SKILL.md path on the host. */
  readonly sourcePath?: string;
}

export type SkillSource = 'fleex' | 'claude_code';
export type ClaudeCodeSkillOrigin = 'user' | 'project' | 'plugin' | 'synced';
export type ClaudeCodeSkillStatus = 'present' | 'missing' | 'invalid' | 'conflict';

/** Admin view of one Claude Code skill mirrored for the current host. */
export interface ClaudeCodeSkill {
  readonly id: string;
  readonly hostId: string;
  readonly origin: ClaudeCodeSkillOrigin;
  readonly nativeName: string;
  readonly commandName: string;
  readonly name: string;
  readonly description: string;
  readonly allowedTools: string[] | null;
  readonly plugin: string | null;
  readonly repo: string | null;
  readonly sourcePath: string;
  readonly realPath: string | null;
  readonly enabled: boolean;
  /** Override; null means the system persona "Claude Code". */
  readonly personaId: string | null;
  readonly status: ClaudeCodeSkillStatus;
  readonly parseError: string | null;
  /** Enabled skill whose SKILL.md changed since it was activated. */
  readonly modifiedSinceActivation: boolean;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaudeCodeSkillScanReport {
  readonly hostId: string;
  readonly added: number;
  readonly changed: number;
  readonly missing: number;
  readonly back: number;
  readonly invalid: number;
  readonly total: number;
}

export interface UpdateClaudeCodeSkillRequest {
  readonly enabled?: boolean;
  /** null resets to the system persona. */
  readonly personaId?: string | null;
  /** Acknowledge a SKILL.md change (clears "modified since activation"). */
  readonly revalidate?: boolean;
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
