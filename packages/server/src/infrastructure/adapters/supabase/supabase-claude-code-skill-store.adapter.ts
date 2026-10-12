import type { ClaudeCodeSkillEntity } from '../../../domain/entities/claude-code-skill.entity.js';
import type { ClaudeCodeSkillStorePort } from '../../../application/ports/claude-code-skill-store.port.js';
import { claudeCodeSkillToRow, rowToClaudeCodeSkill, type ClaudeCodeSkillRow } from '../claude-code-skill-row.js';
import type { SupabaseConnection } from './connection.js';

export class SupabaseClaudeCodeSkillStore implements ClaudeCodeSkillStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async listByHost(hostId: string): Promise<ClaudeCodeSkillEntity[]> {
    const { data, error } = await this.conn.client
      .from('claude_code_skills')
      .select('*')
      .eq('host_id', hostId)
      .order('command_name')
      .order('origin');
    if (error) throw new Error(`SupabaseClaudeCodeSkillStore.listByHost failed: ${error.message}`);
    return (data as ClaudeCodeSkillRow[]).map(rowToClaudeCodeSkill);
  }

  async getById(id: string): Promise<ClaudeCodeSkillEntity | null> {
    const { data, error } = await this.conn.client
      .from('claude_code_skills')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseClaudeCodeSkillStore.getById failed: ${error.message}`);
    return data ? rowToClaudeCodeSkill(data as ClaudeCodeSkillRow) : null;
  }

  async saveMany(skills: ClaudeCodeSkillEntity[]): Promise<void> {
    if (skills.length === 0) return;
    const { error } = await this.conn.client
      .from('claude_code_skills')
      .upsert(skills.map(claudeCodeSkillToRow), { onConflict: 'id' });
    if (error) throw new Error(`SupabaseClaudeCodeSkillStore.saveMany failed: ${error.message}`);
  }

  async clearPersona(personaId: string): Promise<void> {
    const { error } = await this.conn.client
      .from('claude_code_skills')
      .update({ persona_id: null, updated_at: new Date().toISOString() })
      .eq('persona_id', personaId);
    if (error) throw new Error(`SupabaseClaudeCodeSkillStore.clearPersona failed: ${error.message}`);
  }
}
