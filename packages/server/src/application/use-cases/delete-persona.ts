import { AgentPersonaNotFoundError, SystemPersonaProtectedError } from '../../domain/errors.js';
import { CLAUDE_CODE_SYSTEM_PERSONA_NAME } from '../../domain/services/claude-code-skills.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { ClaudeCodeSkillStorePort } from '../ports/claude-code-skill-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class DeletePersonaUseCase {
  constructor(
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
    private readonly claudeCodeSkillStore?: ClaudeCodeSkillStorePort,
  ) {}

  async execute(id: string): Promise<void> {
    const persona = await this.personaStore.getById(id);
    if (!persona) {
      throw new AgentPersonaNotFoundError(id);
    }

    // Imported Claude Code skills run on this persona by default.
    if (persona.name === CLAUDE_CODE_SYSTEM_PERSONA_NAME) {
      throw new SystemPersonaProtectedError(persona.name, 'delete');
    }

    await this.personaStore.remove(id);
    // Skills that overrode their persona with this one fall back to the system persona.
    await this.claudeCodeSkillStore?.clearPersona(id);

    this.logger.info('Persona deleted', { id, name: persona.name });
  }
}
