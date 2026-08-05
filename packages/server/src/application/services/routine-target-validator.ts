import type { RoutineTarget } from '@fleex/shared';
import {
  RoutineTargetNotFoundError,
  WorkflowTemplateNotFoundError,
} from '../../domain/errors.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';

export interface RoutineTargetStores {
  templateStore: WorkflowTemplateStorePort;
  personaStore: PersonaStorePort;
  skillStore: SkillStorePort;
  panelStore: PanelStorePort;
}

/**
 * A routine's target is resolved by name at every run, so a typo'd ref would
 * only surface as a failed run days later. Validating at create/update time
 * turns that into an immediate 404 instead.
 */
export async function assertRoutineTargetExists(
  target: RoutineTarget,
  stores: RoutineTargetStores,
): Promise<void> {
  switch (target.kind) {
    case 'workflow': {
      const template = await stores.templateStore.getById(target.ref);
      if (!template) throw new WorkflowTemplateNotFoundError(target.ref);
      return;
    }
    case 'agent': {
      const persona = await stores.personaStore.getByName(target.ref);
      if (!persona) throw new RoutineTargetNotFoundError('agent', target.ref);
      return;
    }
    case 'skill': {
      const skill = await stores.skillStore.getByCommandName(target.ref);
      if (!skill) throw new RoutineTargetNotFoundError('skill', target.ref);
      return;
    }
    case 'panel': {
      const panel = await stores.panelStore.getByName(target.ref);
      if (!panel) throw new RoutineTargetNotFoundError('panel', target.ref);
      return;
    }
  }
}
