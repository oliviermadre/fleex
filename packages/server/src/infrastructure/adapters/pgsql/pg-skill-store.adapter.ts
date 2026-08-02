import { SkillEntity } from '../../../domain/entities/skill.entity.js';

import type { PgConnection } from './connection.js';
import type { SkillStorePort } from '../../../application/ports/skill-store.port.js';

export class PgSkillStore implements SkillStorePort {
  constructor(private readonly db: PgConnection) {}

  async getAll(): Promise<SkillEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM skills ORDER BY name ASC');
    return rows.map(rowToSkill);
  }

  async getById(id: string): Promise<SkillEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM skills WHERE id = $1', [id]);
    return rows.length > 0 ? rowToSkill(rows[0]) : null;
  }

  async getByCommandName(commandName: string): Promise<SkillEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM skills WHERE command_name = $1', [
      commandName,
    ]);
    return rows.length > 0 ? rowToSkill(rows[0]) : null;
  }

  async getEnabled(): Promise<SkillEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM skills WHERE enabled = true ORDER BY name ASC',
    );
    return rows.map(rowToSkill);
  }

  async save(skill: SkillEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO skills (
        id, command_name, name, display_name, markdown_content, enabled,
        persona_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        command_name = $2,
        name = $3,
        display_name = $4,
        markdown_content = $5,
        enabled = $6,
        persona_id = $7,
        created_at = $8,
        updated_at = $9`,
      [
        skill.id,
        skill.commandName,
        skill.name,
        skill.displayName,
        skill.markdownContent,
        skill.enabled,
        skill.personaId,
        skill.createdAt.toISOString(),
        skill.updatedAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM skills WHERE id = $1', [id]);
  }
}

function rowToSkill(row: Record<string, unknown>): SkillEntity {
  return new SkillEntity(
    row.id as string,
    row.command_name as string,
    row.name as string,
    row.display_name as string,
    (row.markdown_content as string) ?? '',
    row.enabled as boolean,
    row.persona_id as string,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}
