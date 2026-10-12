import type { ClaudeCodeSkillEntity } from '../../domain/entities/claude-code-skill.entity.js';

/** Mirror rows of Claude Code skills. Every read is scoped to one machine. */
export interface ClaudeCodeSkillStorePort {
  listByHost(hostId: string): Promise<ClaudeCodeSkillEntity[]>;
  getById(id: string): Promise<ClaudeCodeSkillEntity | null>;
  saveMany(skills: ClaudeCodeSkillEntity[]): Promise<void>;
  /** A deleted persona's overrides fall back to the system persona. */
  clearPersona(personaId: string): Promise<void>;
}
