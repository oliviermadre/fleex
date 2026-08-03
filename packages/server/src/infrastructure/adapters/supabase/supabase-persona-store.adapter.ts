import { AgentPersonaEntity } from '../../../domain/entities/agent-persona.entity.js';

import type { SupabaseConnection } from './connection.js';
import type { PersonaStorePort } from '../../../application/ports/persona-store.port.js';

interface PersonaRow {
  id: string;
  name: string;
  display_name: string;
  model: string;
  execution_mode: string;
  soul_md: string;
  identity_md: string;
  memory_md: string;
  human_mention_name: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: PersonaRow): AgentPersonaEntity {
  return new AgentPersonaEntity(
    r.id,
    r.name,
    r.display_name,
    r.model,
    (r.execution_mode ?? 'claude_code') as 'claude_code' | 'message',
    r.soul_md ?? '',
    r.identity_md ?? '',
    r.memory_md ?? '',
    r.human_mention_name,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

export class SupabasePersonaStore implements PersonaStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getAll(): Promise<AgentPersonaEntity[]> {
    const { data, error } = await this.conn.client.from('agent_personas').select('*').order('name');
    if (error) throw new Error(`SupabasePersonaStore.getAll failed: ${error.message}`);
    return (data as PersonaRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<AgentPersonaEntity | null> {
    const { data, error } = await this.conn.client
      .from('agent_personas')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabasePersonaStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as PersonaRow) : null;
  }

  async getByName(name: string): Promise<AgentPersonaEntity | null> {
    const { data, error } = await this.conn.client
      .from('agent_personas')
      .select('*')
      .eq('name', name)
      .maybeSingle();
    if (error) throw new Error(`SupabasePersonaStore.getByName failed: ${error.message}`);
    return data ? rowToEntity(data as PersonaRow) : null;
  }

  async save(persona: AgentPersonaEntity): Promise<void> {
    const { error } = await this.conn.client.from('agent_personas').upsert({
      id: persona.id,
      name: persona.name,
      display_name: persona.displayName,
      model: persona.model,
      execution_mode: persona.executionMode,
      soul_md: persona.soulMd,
      identity_md: persona.identityMd,
      memory_md: persona.memoryMd,
      human_mention_name: persona.humanMentionName,
      created_at: persona.createdAt.toISOString(),
      updated_at: persona.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabasePersonaStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client.from('agent_personas').delete().eq('id', id);
    if (error) throw new Error(`SupabasePersonaStore.remove failed: ${error.message}`);
  }
}
