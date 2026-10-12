import type { ClaudeCodeSkillEntity } from '../../../domain/entities/claude-code-skill.entity.js';
import type { ClaudeCodeSkillStorePort } from '../../../application/ports/claude-code-skill-store.port.js';
import {
  CLAUDE_CODE_SKILL_COLUMNS,
  claudeCodeSkillToRow,
  rowToClaudeCodeSkill,
  type ClaudeCodeSkillRow,
} from '../claude-code-skill-row.js';
import type { PgConnection } from './connection.js';

const UPSERT_SQL = `INSERT INTO claude_code_skills (${CLAUDE_CODE_SKILL_COLUMNS.join(', ')})
  VALUES (${CLAUDE_CODE_SKILL_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
  ON CONFLICT (id) DO UPDATE SET ${CLAUDE_CODE_SKILL_COLUMNS.filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`;

export class PgClaudeCodeSkillStore implements ClaudeCodeSkillStorePort {
  constructor(private readonly db: PgConnection) {}

  async listByHost(hostId: string): Promise<ClaudeCodeSkillEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM claude_code_skills WHERE host_id = $1 ORDER BY command_name ASC, origin ASC',
      [hostId],
    );
    return (rows as ClaudeCodeSkillRow[]).map(rowToClaudeCodeSkill);
  }

  async getById(id: string): Promise<ClaudeCodeSkillEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM claude_code_skills WHERE id = $1', [id]);
    return rows.length > 0 ? rowToClaudeCodeSkill(rows[0] as ClaudeCodeSkillRow) : null;
  }

  async saveMany(skills: ClaudeCodeSkillEntity[]): Promise<void> {
    for (const skill of skills) {
      const row = claudeCodeSkillToRow(skill);
      await this.db.query(UPSERT_SQL, CLAUDE_CODE_SKILL_COLUMNS.map((c) =>
        c === 'allowed_tools' ? (row.allowed_tools ? JSON.stringify(row.allowed_tools) : null) : row[c]));
    }
  }

  async clearPersona(personaId: string): Promise<void> {
    await this.db.query(
      'UPDATE claude_code_skills SET persona_id = NULL, updated_at = $1 WHERE persona_id = $2',
      [new Date().toISOString(), personaId],
    );
  }
}
