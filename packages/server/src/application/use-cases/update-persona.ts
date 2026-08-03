import type { ExecutionMode } from '@fleex/shared';

import { AgentPersonaNotFoundError, AgentPersonaNameConflictError } from '../../domain/errors.js';

import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';

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
