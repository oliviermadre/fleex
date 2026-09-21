import type { AgentThreadStatus } from '@fleex/shared';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { PgConnection } from './connection.js';

function rowToThread(row: Record<string, unknown>): AgentThreadEntity {
  return new AgentThreadEntity(
    row.id as string, row.ticket_id as string, 'assistant', row.persona_id as string, row.persona_name as string,
    row.assistant_persona_id as string, row.brief as string, JSON.parse(row.forwarded_context as string) as string[],
    row.status as AgentThreadStatus, (row.current_mention_id as string | null) ?? null, Number(row.exchanges),
    (row.summary as string | null) ?? null, new Date(row.created_at as string), new Date(row.updated_at as string),
    row.concluded_at ? new Date(row.concluded_at as string) : null,
  );
}

export class PgThreadStore implements ThreadStorePort {
  constructor(private readonly db: PgConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM agent_threads WHERE id = $1', [id]);
    return rows.length > 0 ? rowToThread(rows[0]) : null;
  }

  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_threads WHERE ticket_id = $1 ORDER BY created_at DESC, id DESC',
      [ticketId],
    );
    return rows.map(rowToThread);
  }

  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_threads WHERE current_mention_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [mentionId],
    );
    return rows.length > 0 ? rowToThread(rows[0]) : null;
  }

  async getOpen(): Promise<AgentThreadEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM agent_threads WHERE status IN ('running','waiting') ORDER BY created_at DESC`,
    );
    return rows.map(rowToThread);
  }

  async save(t: AgentThreadEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_threads (id, ticket_id, initiator, persona_id, persona_name, assistant_persona_id, brief,
         forwarded_context, status, current_mention_id, exchanges, summary, created_at, updated_at, concluded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET status = $9, current_mention_id = $10, exchanges = $11, summary = $12,
         updated_at = $14, concluded_at = $15`,
      [t.id, t.ticketId, t.initiator, t.personaId, t.personaName, t.assistantPersonaId, t.brief,
       JSON.stringify(t.forwardedContext), t.status, t.currentMentionId, t.exchanges, t.summary,
       t.createdAt.toISOString(), t.updatedAt.toISOString(), t.concludedAt?.toISOString() ?? null],
    );
  }
}
