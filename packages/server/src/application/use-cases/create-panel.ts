import { randomUUID } from 'node:crypto';
import type { PanelMember } from '@fleex/shared';
import { PanelEntity } from '../../domain/entities/panel.entity.js';
import { PanelNameConflictError, AgentPersonaNotFoundError } from '../../domain/errors.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreatePanelUseCase {
  constructor(
    private readonly panelStore: PanelStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    name: string;
    displayName: string;
    description?: string;
    members: PanelMember[];
    orchestratorPrompt?: string;
    orchestratorModel?: string;
    defaultMemberModel?: string;
    enabled?: boolean;
  }): Promise<PanelEntity> {
    // Validate unique name
    const existing = await this.panelStore.getByName(params.name);
    if (existing) {
      throw new PanelNameConflictError(params.name);
    }

    // Validate all member persona IDs exist
    for (const member of params.members) {
      const persona = await this.personaStore.getById(member.personaId);
      if (!persona) {
        throw new AgentPersonaNotFoundError(member.personaId);
      }
    }

    const panel = PanelEntity.create({
      id: randomUUID(),
      name: params.name,
      displayName: params.displayName,
      description: params.description,
      members: params.members,
      orchestratorPrompt: params.orchestratorPrompt,
      orchestratorModel: params.orchestratorModel,
      defaultMemberModel: params.defaultMemberModel,
      enabled: params.enabled,
    });

    await this.panelStore.save(panel);

    this.logger.info('Panel created', { id: panel.id, name: panel.name });

    return panel;
  }
}
