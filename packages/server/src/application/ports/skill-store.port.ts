import type { SkillEntity } from '../../domain/entities/skill.entity.js';

export interface SkillStorePort {
  getAll(): Promise<SkillEntity[]>;
  getById(id: string): Promise<SkillEntity | null>;
  getByCommandName(commandName: string): Promise<SkillEntity | null>;
  getEnabled(): Promise<SkillEntity[]>;
  save(skill: SkillEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
