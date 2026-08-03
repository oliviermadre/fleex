import { SkillEntity } from '../../../domain/entities/skill.entity.js';

import type { SupabaseConnection } from './connection.js';
import type { SkillStorePort } from '../../../application/ports/skill-store.port.js';

interface SkillRow {
  id: string;
  command_name: string;
  name: string;
  display_name: string;
  markdown_content: string;
  enabled: boolean;
  persona_id: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: SkillRow): SkillEntity {
  return new SkillEntity(
    r.id,
    r.command_name,
    r.name,
    r.display_name,
    r.markdown_content ?? '',
    r.enabled,
    r.persona_id,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

export class SupabaseSkillStore implements SkillStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getAll(): Promise<SkillEntity[]> {
    const { data, error } = await this.conn.client.from('skills').select('*').order('name');
    if (error) throw new Error(`SupabaseSkillStore.getAll failed: ${error.message}`);
    return (data as SkillRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<SkillEntity | null> {
    const { data, error } = await this.conn.client
      .from('skills')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseSkillStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as SkillRow) : null;
  }

  async getByCommandName(commandName: string): Promise<SkillEntity | null> {
    const { data, error } = await this.conn.client
      .from('skills')
      .select('*')
      .eq('command_name', commandName)
      .maybeSingle();
    if (error) throw new Error(`SupabaseSkillStore.getByCommandName failed: ${error.message}`);
    return data ? rowToEntity(data as SkillRow) : null;
  }

  async getEnabled(): Promise<SkillEntity[]> {
    const { data, error } = await this.conn.client
      .from('skills')
      .select('*')
      .eq('enabled', true)
      .order('name');
    if (error) throw new Error(`SupabaseSkillStore.getEnabled failed: ${error.message}`);
    return (data as SkillRow[]).map(rowToEntity);
  }

  async save(skill: SkillEntity): Promise<void> {
    const { error } = await this.conn.client.from('skills').upsert({
      id: skill.id,
      command_name: skill.commandName,
      name: skill.name,
      display_name: skill.displayName,
      markdown_content: skill.markdownContent,
      enabled: skill.enabled,
      persona_id: skill.personaId,
      created_at: skill.createdAt.toISOString(),
      updated_at: skill.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseSkillStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client.from('skills').delete().eq('id', id);
    if (error) throw new Error(`SupabaseSkillStore.remove failed: ${error.message}`);
  }
}
