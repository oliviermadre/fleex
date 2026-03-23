import type { PanelMember } from '@fleex/shared';
import { PanelNotFoundError, PanelNameConflictError, AgentPersonaNotFoundError } from '../../domain/errors.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { PanelEntity } from '../../domain/entities/panel.entity.js';

export class UpdatePanelUseCase {
  constructor(
    private readonly panelStore: PanelStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    id: string,
    changes: {
      name?: string;
      displayName?: string;
      description?: string;
      members?: PanelMember[];
      orchestratorPrompt?: string;
      orchestratorModel?: string;
      defaultMemberModel?: string;
      enabled?: boolean;
    },
  ): Promise<PanelEntity> {
    const panel = await this.panelStore.getById(id);
    if (!panel) {
      throw new PanelNotFoundError(id);
    }

    // Validate name uniqueness if changing
    if (changes.name && changes.name !== panel.name) {
      const existing = await this.panelStore.getByName(changes.name);
      if (existing) {
        throw new PanelNameConflictError(changes.name);
      }
    }

    // Validate member persona IDs if changing
    if (changes.members) {
      for (const member of changes.members) {
        const persona = await this.personaStore.getById(member.personaId);
        if (!persona) {
          throw new AgentPersonaNotFoundError(member.personaId);
        }
      }
    }

    panel.update(changes);
    await this.panelStore.save(panel);

    this.logger.info('Panel updated', { id: panel.id, name: panel.name });

    return panel;
  }
}
