import { AgentPersonaNotFoundError } from '../../domain/errors.js';

import type { LoggerPort } from '../ports/logger.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';

export class DeletePersonaUseCase {
  constructor(
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(id: string): Promise<void> {
    const persona = await this.personaStore.getById(id);
    if (!persona) {
      throw new AgentPersonaNotFoundError(id);
    }

    await this.personaStore.remove(id);

    this.logger.info('Persona deleted', { id, name: persona.name });
  }
}
