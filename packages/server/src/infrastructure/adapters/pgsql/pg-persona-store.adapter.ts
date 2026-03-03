import { AgentPersonaEntity } from '../../../domain/entities/agent-persona.entity.js';
import type { PersonaStorePort } from '../../../application/ports/persona-store.port.js';
import type { PgConnection } from './connection.js';

export class PgPersonaStore implements PersonaStorePort {
  constructor(private readonly db: PgConnection) {}

  async getAll(): Promise<AgentPersonaEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_personas ORDER BY name ASC',
    );
    return rows.map(rowToPersona);
  }

  async getById(id: string): Promise<AgentPersonaEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM agent_personas WHERE id = $1', [id]);
    return rows.length > 0 ? rowToPersona(rows[0]) : null;
  }

  async getByName(name: string): Promise<AgentPersonaEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM agent_personas WHERE name = $1', [name]);
    return rows.length > 0 ? rowToPersona(rows[0]) : null;
  }

  async save(persona: AgentPersonaEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_personas (
        id, name, display_name, model, soul_md, identity_md, memory_md,
        human_mention_name, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        name = $2,
        display_name = $3,
        model = $4,
        soul_md = $5,
        identity_md = $6,
        memory_md = $7,
        human_mention_name = $8,
        created_at = $9,
        updated_at = $10`,
      [
        persona.id,
        persona.name,
        persona.displayName,
        persona.model,
        persona.soulMd,
        persona.identityMd,
        persona.memoryMd,
        persona.humanMentionName,
        persona.createdAt.toISOString(),
        persona.updatedAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM agent_personas WHERE id = $1', [id]);
  }
}

function rowToPersona(row: Record<string, unknown>): AgentPersonaEntity {
  return new AgentPersonaEntity(
    row.id as string,
    row.name as string,
    row.display_name as string,
    row.model as string,
    (row.soul_md as string) ?? '',
    (row.identity_md as string) ?? '',
    (row.memory_md as string) ?? '',
    (row.human_mention_name as string) ?? null,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}
