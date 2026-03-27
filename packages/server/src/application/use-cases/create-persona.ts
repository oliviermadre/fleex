import { randomUUID } from 'node:crypto';
import type { ExecutionMode } from '@fleex/shared';
import { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import { AgentPersonaNameConflictError } from '../../domain/errors.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreatePersonaUseCase {
  constructor(
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    name: string;
    displayName: string;
    model?: string;
    executionMode?: ExecutionMode;
    soulMd?: string;
    identityMd?: string;
    memoryMd?: string;
    humanMentionName?: string | null;
  }): Promise<AgentPersonaEntity> {
    const existing = await this.personaStore.getByName(params.name);
    if (existing) {
      throw new AgentPersonaNameConflictError(params.name);
    }

    const persona = AgentPersonaEntity.create({
      id: randomUUID(),
      name: params.name,
      displayName: params.displayName,
      model: params.model,
      executionMode: params.executionMode,
      soulMd: params.soulMd,
      identityMd: params.identityMd,
      memoryMd: params.memoryMd,
      humanMentionName: params.humanMentionName,
    });

    await this.personaStore.save(persona);

    this.logger.info('Persona created', { id: persona.id, name: persona.name });

    return persona;
  }
}
