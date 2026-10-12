import type { ClaudeCodeSkillEntity } from '../../../domain/entities/claude-code-skill.entity.js';
import type { ClaudeCodeSkillStorePort } from '../../../application/ports/claude-code-skill-store.port.js';
import {
  CLAUDE_CODE_SKILL_COLUMNS,
  claudeCodeSkillToRow,
  rowToClaudeCodeSkill,
  type ClaudeCodeSkillRow,
} from '../claude-code-skill-row.js';
import type { SqliteConnection } from './connection.js';

const UPSERT_SQL = `INSERT OR REPLACE INTO claude_code_skills (${CLAUDE_CODE_SKILL_COLUMNS.join(', ')})
  VALUES (${CLAUDE_CODE_SKILL_COLUMNS.map((c) => `@${c}`).join(', ')})`;

export class SqliteClaudeCodeSkillStoreAdapter implements ClaudeCodeSkillStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async listByHost(hostId: string): Promise<ClaudeCodeSkillEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM claude_code_skills WHERE host_id = ? ORDER BY command_name ASC, origin ASC')
      .all(hostId) as ClaudeCodeSkillRow[];
    return rows.map(rowToClaudeCodeSkill);
  }

  async getById(id: string): Promise<ClaudeCodeSkillEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM claude_code_skills WHERE id = ?')
      .get(id) as ClaudeCodeSkillRow | undefined;
    return row ? rowToClaudeCodeSkill(row) : null;
  }

  async saveMany(skills: ClaudeCodeSkillEntity[]): Promise<void> {
    const stmt = this.conn.db.prepare(UPSERT_SQL);
    for (const skill of skills) {
      const row = claudeCodeSkillToRow(skill);
      stmt.run({
        ...row,
        enabled: row.enabled ? 1 : 0,
        allowed_tools: row.allowed_tools ? JSON.stringify(row.allowed_tools) : null,
      });
    }
  }

  async clearPersona(personaId: string): Promise<void> {
    this.conn.db
      .prepare('UPDATE claude_code_skills SET persona_id = NULL, updated_at = ? WHERE persona_id = ?')
      .run(new Date().toISOString(), personaId);
  }
}
