import type { AgentThreadStatus } from '@fleex/shared';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface ThreadRow {
  id: string; ticket_id: string; persona_id: string; persona_name: string; assistant_persona_id: string;
  brief: string; forwarded_context: string; status: string; current_mention_id: string | null;
  exchanges: number; summary: string | null; created_at: string; updated_at: string; concluded_at: string | null;
}

function rowToEntity(r: ThreadRow): AgentThreadEntity {
  return new AgentThreadEntity(
    r.id, r.ticket_id, 'assistant', r.persona_id, r.persona_name, r.assistant_persona_id, r.brief,
    JSON.parse(r.forwarded_context) as string[], r.status as AgentThreadStatus, r.current_mention_id,
    Number(r.exchanges), r.summary, new Date(r.created_at), new Date(r.updated_at),
    r.concluded_at ? new Date(r.concluded_at) : null,
  );
}

export class SupabaseThreadStore implements ThreadStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseThreadStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as ThreadRow) : null;
  }

  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .eq('ticket_id', ticketId).order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseThreadStore.getByTicket failed: ${error.message}`);
    return (data as ThreadRow[]).map(rowToEntity);
  }

  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .eq('current_mention_id', mentionId).order('updated_at', { ascending: false }).limit(1);
    if (error) throw new Error(`SupabaseThreadStore.getByCurrentMentionId failed: ${error.message}`);
    const rows = data as ThreadRow[];
    return rows.length > 0 ? rowToEntity(rows[0]!) : null;
  }

  async getOpen(): Promise<AgentThreadEntity[]> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .in('status', ['running', 'waiting']).order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseThreadStore.getOpen failed: ${error.message}`);
    return (data as ThreadRow[]).map(rowToEntity);
  }

  async save(t: AgentThreadEntity): Promise<void> {
    const { error } = await this.conn.client.from('agent_threads').upsert({
      id: t.id, ticket_id: t.ticketId, initiator: t.initiator, persona_id: t.personaId,
      persona_name: t.personaName, assistant_persona_id: t.assistantPersonaId, brief: t.brief,
      forwarded_context: JSON.stringify(t.forwardedContext), status: t.status,
      current_mention_id: t.currentMentionId, exchanges: t.exchanges, summary: t.summary,
      created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
      concluded_at: t.concludedAt?.toISOString() ?? null,
    });
    if (error) throw new Error(`SupabaseThreadStore.save failed: ${error.message}`);
  }
}
