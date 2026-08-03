import { AgentPersonaEntity } from '../../../domain/entities/agent-persona.entity.js';

import type { SqliteConnection } from './connection.js';
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

export class SqlitePersonaStoreAdapter implements PersonaStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getAll(): Promise<AgentPersonaEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM agent_personas ORDER BY name ASC')
      .all() as PersonaRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<AgentPersonaEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM agent_personas WHERE id = ?').get(id) as
      PersonaRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByName(name: string): Promise<AgentPersonaEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM agent_personas WHERE name = ?').get(name) as
      PersonaRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async save(persona: AgentPersonaEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO agent_personas
        (id, name, display_name, model, execution_mode, soul_md, identity_md, memory_md,
         human_mention_name, created_at, updated_at)
      VALUES
        (@id, @name, @display_name, @model, @execution_mode, @soul_md, @identity_md, @memory_md,
         @human_mention_name, @created_at, @updated_at)
    `);

    stmt.run({
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
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM agent_personas WHERE id = ?').run(id);
  }

  private toEntity(row: PersonaRow): AgentPersonaEntity {
    return new AgentPersonaEntity(
      row.id,
      row.name,
      row.display_name,
      row.model,
      (row.execution_mode as 'claude_code' | 'message') ?? 'claude_code',
      row.soul_md,
      row.identity_md,
      row.memory_md,
      row.human_mention_name,
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }
}
