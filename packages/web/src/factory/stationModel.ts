/**
 * The model a station runs on, as written under it on the floor. An agent station runs on its own model when it has
 * one, else on its persona's (the server does the same, `station-runner.ts`); a skill station likewise, its persona
 * being the one the skill belongs to; a panel runs on its orchestrator's. Scripts, gates and status stations call no
 * model: they get nothing.
 */
import type { StationSpec } from './types';

export interface ModelSources {
  personas: readonly { id?: string; name: string; model?: string }[];
  skills: readonly { commandName: string; personaId: string }[];
  panels: readonly { name: string; orchestratorModel?: string }[];
}

export function stationModel(m: Pick<StationSpec, 'exec' | 'ref' | 'model'>, src: ModelSources): string | null {
  if (m.exec === 'agent') return m.model || src.personas.find((p) => p.name === m.ref)?.model || null;
  if (m.exec === 'skill') {
    const skill = src.skills.find((s) => s.commandName === m.ref);
    return m.model || (skill && src.personas.find((p) => p.id === skill.personaId)?.model) || null;
  }
  if (m.exec === 'panel') return src.panels.find((p) => p.name === m.ref)?.orchestratorModel || null;
  return null;
}

/** How a model id reads on the floor: without the 'claude-' every id shares, as `ModelBadge` writes it. */
export const modelTag = (id: string): string => id.replace(/^claude-/, '');
