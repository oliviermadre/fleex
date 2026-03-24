import { PanelEntity } from '../../../domain/entities/panel.entity.js';
import type { PanelStorePort } from '../../../application/ports/panel-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { PanelMember } from '@fleex/shared';

interface PanelRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  members: string; // JSON
  orchestrator_prompt: string;
  orchestrator_model: string;
  orchestrator_persona_id: string | null;
  default_member_model: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class SqlitePanelStoreAdapter implements PanelStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getAll(): Promise<PanelEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM panels ORDER BY name ASC')
      .all() as PanelRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<PanelEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM panels WHERE id = ?')
      .get(id) as PanelRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByName(name: string): Promise<PanelEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM panels WHERE name = ?')
      .get(name) as PanelRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getEnabled(): Promise<PanelEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM panels WHERE enabled = 1 ORDER BY name ASC')
      .all() as PanelRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async save(panel: PanelEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO panels
        (id, name, display_name, description, members, orchestrator_prompt,
         orchestrator_model, orchestrator_persona_id, default_member_model, enabled, created_at, updated_at)
      VALUES
        (@id, @name, @display_name, @description, @members, @orchestrator_prompt,
         @orchestrator_model, @orchestrator_persona_id, @default_member_model, @enabled, @created_at, @updated_at)
    `);

    stmt.run({
      id: panel.id,
      name: panel.name,
      display_name: panel.displayName,
      description: panel.description,
      members: JSON.stringify(panel.members),
      orchestrator_prompt: panel.orchestratorPrompt,
      orchestrator_model: panel.orchestratorModel,
      orchestrator_persona_id: panel.orchestratorPersonaId,
      default_member_model: panel.defaultMemberModel,
      enabled: panel.enabled ? 1 : 0,
      created_at: panel.createdAt.toISOString(),
      updated_at: panel.updatedAt.toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM panels WHERE id = ?').run(id);
  }

  private toEntity(row: PanelRow): PanelEntity {
    let members: PanelMember[];
    try {
      members = JSON.parse(row.members);
    } catch {
      members = [];
    }

    return new PanelEntity(
      row.id,
      row.name,
      row.display_name,
      row.description,
      members,
      row.orchestrator_prompt,
      row.orchestrator_model,
      row.orchestrator_persona_id ?? null,
      row.default_member_model,
      row.enabled === 1,
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }
}
