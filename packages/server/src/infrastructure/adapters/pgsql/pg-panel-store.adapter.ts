import type { PanelMember } from '@fleex/shared';

import { PanelEntity } from '../../../domain/entities/panel.entity.js';

import type { PgConnection } from './connection.js';
import type { PanelStorePort } from '../../../application/ports/panel-store.port.js';

export class PgPanelStore implements PanelStorePort {
  constructor(private readonly db: PgConnection) {}

  async getAll(): Promise<PanelEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM panels ORDER BY name ASC');
    return rows.map(rowToPanel);
  }

  async getById(id: string): Promise<PanelEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM panels WHERE id = $1', [id]);
    return rows.length > 0 ? rowToPanel(rows[0]) : null;
  }

  async getByName(name: string): Promise<PanelEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM panels WHERE name = $1', [name]);
    return rows.length > 0 ? rowToPanel(rows[0]) : null;
  }

  async getEnabled(): Promise<PanelEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM panels WHERE enabled = true ORDER BY name ASC',
    );
    return rows.map(rowToPanel);
  }

  async save(panel: PanelEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO panels (
        id, name, display_name, description, execution_mode, members, orchestrator_prompt,
        orchestrator_model, orchestrator_persona_id, default_member_model, enabled, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        name = $2, display_name = $3, description = $4, execution_mode = $5, members = $6,
        orchestrator_prompt = $7, orchestrator_model = $8, orchestrator_persona_id = $9,
        default_member_model = $10, enabled = $11, created_at = $12, updated_at = $13`,
      [
        panel.id,
        panel.name,
        panel.displayName,
        panel.description,
        panel.executionMode,
        JSON.stringify(panel.members),
        panel.orchestratorPrompt,
        panel.orchestratorModel,
        panel.orchestratorPersonaId,
        panel.defaultMemberModel,
        panel.enabled,
        panel.createdAt.toISOString(),
        panel.updatedAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM panels WHERE id = $1', [id]);
  }
}

function rowToPanel(row: Record<string, unknown>): PanelEntity {
  let members: PanelMember[];
  try {
    members =
      typeof row.members === 'string' ? JSON.parse(row.members) : (row.members as PanelMember[]);
  } catch {
    members = [];
  }

  return new PanelEntity(
    row.id as string,
    row.name as string,
    row.display_name as string,
    (row.description as string) ?? '',
    ((row.execution_mode as string) ?? 'claude_code') as 'claude_code' | 'message',
    members,
    (row.orchestrator_prompt as string) ?? '',
    (row.orchestrator_model as string) ?? 'claude-sonnet-4-5-20250929',
    (row.orchestrator_persona_id as string) ?? null,
    (row.default_member_model as string) ?? 'claude-sonnet-4-5-20250929',
    row.enabled as boolean,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}
