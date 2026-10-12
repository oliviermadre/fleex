import type { ExecutionMode } from '@fleex/shared';
import { AgentPersonaNotFoundError, AgentPersonaNameConflictError, SystemPersonaProtectedError } from '../../domain/errors.js';
import { CLAUDE_CODE_SYSTEM_PERSONA_NAME } from '../../domain/services/claude-code-skills.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';

export class UpdatePersonaUseCase {
  constructor(
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    id: string,
    changes: {
      name?: string;
      displayName?: string;
      model?: string;
      executionMode?: ExecutionMode;
      soulMd?: string;
      identityMd?: string;
      memoryMd?: string;
      humanMentionName?: string | null;
    },
  ): Promise<AgentPersonaEntity> {
    const persona = await this.personaStore.getById(id);
    if (!persona) {
      throw new AgentPersonaNotFoundError(id);
    }

    // Check name uniqueness if name is changing
    if (changes.name && changes.name !== persona.name) {
      if (persona.name === CLAUDE_CODE_SYSTEM_PERSONA_NAME) {
        throw new SystemPersonaProtectedError(persona.name, 'rename');
      }
      const existing = await this.personaStore.getByName(changes.name);
      if (existing) {
        throw new AgentPersonaNameConflictError(changes.name);
      }
    }

    persona.update(changes);
    await this.personaStore.save(persona);

    this.logger.info('Persona updated', { id: persona.id, name: persona.name });

    return persona;
  }
}
