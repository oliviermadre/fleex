import { TicketDeliverableEntity } from '../../../domain/entities/ticket-deliverable.entity.js';
import type { DeliverableStorePort } from '../../../application/ports/deliverable-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface DeliverableRow {
  id: string;
  ticket_id: string;
  agent_name: string;
  type: string;
  title: string;
  content: string;
  version: number;
  status: string;
  mention_id: string | null;
  excluded_from_context: boolean;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: DeliverableRow): TicketDeliverableEntity {
  return new TicketDeliverableEntity(
    r.id,
    r.ticket_id,
    r.agent_name,
    r.type,
    r.title,
    r.content,
    r.version,
    r.status as 'draft' | 'final',
    r.mention_id,
    r.excluded_from_context ?? false,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

export class SupabaseDeliverableStore implements DeliverableStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('ticket_id', ticketId);
    if (error) throw new Error(`SupabaseDeliverableStore.getByTicket failed: ${error.message}`);
    return (data as DeliverableRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<TicketDeliverableEntity | null> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseDeliverableStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as DeliverableRow) : null;
  }

  async getAll(): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .order('created_at');
    if (error) throw new Error(`SupabaseDeliverableStore.getAll failed: ${error.message}`);
    return (data as DeliverableRow[]).map(rowToEntity);
  }

  async getByTicketAndType(ticketId: string, type: string): Promise<TicketDeliverableEntity | null> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('type', type)
      .maybeSingle();
    if (error) throw new Error(`SupabaseDeliverableStore.getByTicketAndType failed: ${error.message}`);
    return data ? rowToEntity(data as DeliverableRow) : null;
  }

  async getAllByType(type: string): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('type', type)
      .order('created_at');
    if (error) throw new Error(`SupabaseDeliverableStore.getAllByType failed: ${error.message}`);
    return (data as DeliverableRow[]).map(rowToEntity);
  }

  async save(deliverable: TicketDeliverableEntity): Promise<void> {
    const { error } = await this.conn.client.from('deliverables').upsert({
      id: deliverable.id,
      ticket_id: deliverable.ticketId,
      agent_name: deliverable.agentName,
      type: deliverable.type,
      title: deliverable.title,
      content: deliverable.content,
      version: deliverable.version,
      status: deliverable.status,
      mention_id: deliverable.mentionId,
      excluded_from_context: deliverable.excludedFromContext,
      created_at: deliverable.createdAt.toISOString(),
      updated_at: deliverable.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseDeliverableStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('deliverables')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseDeliverableStore.remove failed: ${error.message}`);
  }
}
