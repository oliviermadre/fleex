import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';

export interface PersonaStorePort {
  getAll(): Promise<AgentPersonaEntity[]>;
  getById(id: string): Promise<AgentPersonaEntity | null>;
  getByName(name: string): Promise<AgentPersonaEntity | null>;
  save(persona: AgentPersonaEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
