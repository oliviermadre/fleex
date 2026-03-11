import { randomUUID } from 'node:crypto';
import { SkillEntity } from '../../domain/entities/skill.entity.js';
import { SkillCommandNameConflictError, AgentPersonaNotFoundError } from '../../domain/errors.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreateSkillUseCase {
  constructor(
    private readonly skillStore: SkillStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    commandName: string;
    name: string;
    displayName: string;
    markdownContent?: string;
    enabled?: boolean;
    personaId: string;
  }): Promise<SkillEntity> {
    const existing = await this.skillStore.getByCommandName(params.commandName);
    if (existing) {
      throw new SkillCommandNameConflictError(params.commandName);
    }

    const persona = await this.personaStore.getById(params.personaId);
    if (!persona) {
      throw new AgentPersonaNotFoundError(params.personaId);
    }

    const skill = SkillEntity.create({
      id: randomUUID(),
      commandName: params.commandName,
      name: params.name,
      displayName: params.displayName,
      markdownContent: params.markdownContent,
      enabled: params.enabled,
      personaId: params.personaId,
    });

    await this.skillStore.save(skill);

    this.logger.info('Skill created', { id: skill.id, commandName: skill.commandName });

    return skill;
  }
}
