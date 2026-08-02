import type { PanelMember } from '@fleex/shared';

import { PanelEntity } from '../../../domain/entities/panel.entity.js';

import type { SupabaseConnection } from './connection.js';
import type { PanelStorePort } from '../../../application/ports/panel-store.port.js';

interface PanelRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  execution_mode: string;
  members: PanelMember[] | string;
  orchestrator_prompt: string;
  orchestrator_model: string;
  orchestrator_persona_id: string | null;
  default_member_model: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: PanelRow): PanelEntity {
  let members: PanelMember[];
  try {
    members = typeof r.members === 'string' ? JSON.parse(r.members) : r.members;
  } catch {
    members = [];
  }

  return new PanelEntity(
    r.id,
    r.name,
    r.display_name,
    r.description ?? '',
    (r.execution_mode ?? 'claude_code') as 'claude_code' | 'message',
    members,
    r.orchestrator_prompt ?? '',
    r.orchestrator_model ?? 'claude-sonnet-4-5-20250929',
    r.orchestrator_persona_id ?? null,
    r.default_member_model ?? 'claude-sonnet-4-5-20250929',
    r.enabled,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

export class SupabasePanelStore implements PanelStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getAll(): Promise<PanelEntity[]> {
    const { data, error } = await this.conn.client.from('panels').select('*').order('name');
    if (error) throw new Error(`SupabasePanelStore.getAll failed: ${error.message}`);
    return (data as PanelRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<PanelEntity | null> {
    const { data, error } = await this.conn.client
      .from('panels')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabasePanelStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as PanelRow) : null;
  }

  async getByName(name: string): Promise<PanelEntity | null> {
    const { data, error } = await this.conn.client
      .from('panels')
      .select('*')
      .eq('name', name)
      .maybeSingle();
    if (error) throw new Error(`SupabasePanelStore.getByName failed: ${error.message}`);
    return data ? rowToEntity(data as PanelRow) : null;
  }

  async getEnabled(): Promise<PanelEntity[]> {
    const { data, error } = await this.conn.client
      .from('panels')
      .select('*')
      .eq('enabled', true)
      .order('name');
    if (error) throw new Error(`SupabasePanelStore.getEnabled failed: ${error.message}`);
    return (data as PanelRow[]).map(rowToEntity);
  }

  async save(panel: PanelEntity): Promise<void> {
    const { error } = await this.conn.client.from('panels').upsert({
      id: panel.id,
      name: panel.name,
      display_name: panel.displayName,
      description: panel.description,
      execution_mode: panel.executionMode,
      members: panel.members,
      orchestrator_prompt: panel.orchestratorPrompt,
      orchestrator_model: panel.orchestratorModel,
      orchestrator_persona_id: panel.orchestratorPersonaId,
      default_member_model: panel.defaultMemberModel,
      enabled: panel.enabled,
      created_at: panel.createdAt.toISOString(),
      updated_at: panel.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabasePanelStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client.from('panels').delete().eq('id', id);
    if (error) throw new Error(`SupabasePanelStore.remove failed: ${error.message}`);
  }
}
