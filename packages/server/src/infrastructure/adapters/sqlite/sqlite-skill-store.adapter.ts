import { SkillEntity } from '../../../domain/entities/skill.entity.js';

import type { SqliteConnection } from './connection.js';
import type { SkillStorePort } from '../../../application/ports/skill-store.port.js';

interface SkillRow {
  id: string;
  command_name: string;
  name: string;
  display_name: string;
  markdown_content: string;
  enabled: number;
  persona_id: string;
  created_at: string;
  updated_at: string;
}

export class SqliteSkillStoreAdapter implements SkillStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getAll(): Promise<SkillEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM skills ORDER BY name ASC').all() as SkillRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<SkillEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      SkillRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByCommandName(commandName: string): Promise<SkillEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM skills WHERE command_name = ?')
      .get(commandName) as SkillRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getEnabled(): Promise<SkillEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM skills WHERE enabled = 1 ORDER BY name ASC')
      .all() as SkillRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async save(skill: SkillEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO skills
        (id, command_name, name, display_name, markdown_content, enabled,
         persona_id, created_at, updated_at)
      VALUES
        (@id, @command_name, @name, @display_name, @markdown_content, @enabled,
         @persona_id, @created_at, @updated_at)
    `);

    stmt.run({
      id: skill.id,
      command_name: skill.commandName,
      name: skill.name,
      display_name: skill.displayName,
      markdown_content: skill.markdownContent,
      enabled: skill.enabled ? 1 : 0,
      persona_id: skill.personaId,
      created_at: skill.createdAt.toISOString(),
      updated_at: skill.updatedAt.toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  }

  private toEntity(row: SkillRow): SkillEntity {
    return new SkillEntity(
      row.id,
      row.command_name,
      row.name,
      row.display_name,
      row.markdown_content,
      row.enabled === 1,
      row.persona_id,
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }
}
