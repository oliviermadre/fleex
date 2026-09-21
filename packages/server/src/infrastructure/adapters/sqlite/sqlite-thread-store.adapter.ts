import type { AgentThreadStatus } from '@fleex/shared';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { SqliteConnection } from './connection.js';

interface ThreadRow {
  id: string; ticket_id: string; initiator: string; persona_id: string; persona_name: string;
  assistant_persona_id: string; brief: string; forwarded_context: string; status: string;
  current_mention_id: string | null; exchanges: number; summary: string | null;
  created_at: string; updated_at: string; concluded_at: string | null;
}

export function threadRowToEntity(r: ThreadRow): AgentThreadEntity {
  return new AgentThreadEntity(
    r.id, r.ticket_id, 'assistant', r.persona_id, r.persona_name, r.assistant_persona_id, r.brief,
    JSON.parse(r.forwarded_context) as string[], r.status as AgentThreadStatus, r.current_mention_id,
    Number(r.exchanges), r.summary, new Date(r.created_at), new Date(r.updated_at),
    r.concluded_at ? new Date(r.concluded_at) : null,
  );
}

export function threadEntityToRow(t: AgentThreadEntity): ThreadRow {
  return {
    id: t.id, ticket_id: t.ticketId, initiator: t.initiator, persona_id: t.personaId,
    persona_name: t.personaName, assistant_persona_id: t.assistantPersonaId, brief: t.brief,
    forwarded_context: JSON.stringify(t.forwardedContext), status: t.status,
    current_mention_id: t.currentMentionId, exchanges: t.exchanges, summary: t.summary,
    created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
    concluded_at: t.concludedAt?.toISOString() ?? null,
  };
}

export class SqliteThreadStoreAdapter implements ThreadStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM agent_threads WHERE id = ?').get(id) as ThreadRow | undefined;
    return row ? threadRowToEntity(row) : null;
  }

  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM agent_threads WHERE ticket_id = ? ORDER BY created_at DESC, id DESC')
      .all(ticketId) as ThreadRow[];
    return rows.map(threadRowToEntity);
  }

  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM agent_threads WHERE current_mention_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(mentionId) as ThreadRow | undefined;
    return row ? threadRowToEntity(row) : null;
  }

  async getOpen(): Promise<AgentThreadEntity[]> {
    const rows = this.conn.db
      .prepare(`SELECT * FROM agent_threads WHERE status IN ('running', 'waiting') ORDER BY created_at DESC`)
      .all() as ThreadRow[];
    return rows.map(threadRowToEntity);
  }

  async save(thread: AgentThreadEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO agent_threads
        (id, ticket_id, initiator, persona_id, persona_name, assistant_persona_id, brief, forwarded_context,
         status, current_mention_id, exchanges, summary, created_at, updated_at, concluded_at)
      VALUES
        (@id, @ticket_id, @initiator, @persona_id, @persona_name, @assistant_persona_id, @brief, @forwarded_context,
         @status, @current_mention_id, @exchanges, @summary, @created_at, @updated_at, @concluded_at)
    `).run(threadEntityToRow(thread));
  }
}
