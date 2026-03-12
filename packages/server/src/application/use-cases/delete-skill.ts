import { SkillNotFoundError } from '../../domain/errors.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class DeleteSkillUseCase {
  constructor(
    private readonly skillStore: SkillStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(id: string): Promise<void> {
    const skill = await this.skillStore.getById(id);
    if (!skill) {
      throw new SkillNotFoundError(id);
    }

    await this.skillStore.remove(id);

    this.logger.info('Skill deleted', { id, commandName: skill.commandName });
  }
}
