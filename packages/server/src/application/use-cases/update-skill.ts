import { SkillNotFoundError, SkillCommandNameConflictError, AgentPersonaNotFoundError } from '../../domain/errors.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SkillEntity } from '../../domain/entities/skill.entity.js';

export class UpdateSkillUseCase {
  constructor(
    private readonly skillStore: SkillStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    id: string,
    changes: {
      commandName?: string;
      name?: string;
      displayName?: string;
      markdownContent?: string;
      enabled?: boolean;
      personaId?: string;
    },
  ): Promise<SkillEntity> {
    const skill = await this.skillStore.getById(id);
    if (!skill) {
      throw new SkillNotFoundError(id);
    }

    if (changes.commandName && changes.commandName !== skill.commandName) {
      const existing = await this.skillStore.getByCommandName(changes.commandName);
      if (existing) {
        throw new SkillCommandNameConflictError(changes.commandName);
      }
    }

    if (changes.personaId && changes.personaId !== skill.personaId) {
      const persona = await this.personaStore.getById(changes.personaId);
      if (!persona) {
        throw new AgentPersonaNotFoundError(changes.personaId);
      }
    }

    skill.update(changes);
    await this.skillStore.save(skill);

    this.logger.info('Skill updated', { id: skill.id, commandName: skill.commandName });

    return skill;
  }
}
