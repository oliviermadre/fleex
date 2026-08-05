import type { DeliverableType, DeliverableStatus } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../../domain/entities/ticket-deliverable.entity.js';
import type { DeliverableStorePort } from '../../../application/ports/deliverable-store.port.js';
import type { SupabaseConnection } from './connection.js';
import { chunkIds } from './supabase-chunk.js';

interface DeliverableRow {
  id: string;
  ticket_id: string | null;
  workflow_run_id: string | null;
  step_run_id: string | null;
  agent_name: string;
  type: DeliverableType;
  title: string;
  content: string;
  version: number;
  status: DeliverableStatus;
  mention_id: string | null;
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
    r.status,
    r.mention_id,
    new Date(r.created_at),
    new Date(r.updated_at),
    r.workflow_run_id ?? null,
    r.step_run_id ?? null,
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

  async getByTicketIds(ticketIds: string[]): Promise<TicketDeliverableEntity[]> {
    if (ticketIds.length === 0) return [];
    // PostgREST silently caps responses at max-rows (Supabase default: 1000).
    // Bulk callers (unread-counts for the cockpit view) can match far more, so
    // paginate explicitly — otherwise counts silently truncate (bug #400).
    // Ordering (created_at, id) is required for stable, non-overlapping pages.
    // `.in()` lands in the query string, which Supabase's proxy caps at ~8 KB —
    // so the ID list is chunked before paginating each chunk (#509).
    const PAGE = 1000;
    const rows: DeliverableRow[] = [];
    for (const chunk of chunkIds(ticketIds)) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.conn.client
          .from('deliverables')
          .select('*')
          .in('ticket_id', chunk)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`SupabaseDeliverableStore.getByTicketIds failed: ${error.message}`);
        const page = data as DeliverableRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
    }
    return rows.map(rowToEntity);
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

  async getByWorkflowRun(workflowRunId: string): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('workflow_run_id', workflowRunId)
      .order('created_at');
    if (error) throw new Error(`SupabaseDeliverableStore.getByWorkflowRun failed: ${error.message}`);
    return (data as DeliverableRow[]).map(rowToEntity);
  }

  async getByStepRun(stepRunId: string): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('step_run_id', stepRunId)
      .order('created_at');
    if (error) throw new Error(`SupabaseDeliverableStore.getByStepRun failed: ${error.message}`);
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
      workflow_run_id: deliverable.workflowRunId,
      step_run_id: deliverable.stepRunId,
      agent_name: deliverable.agentName,
      type: deliverable.type,
      title: deliverable.title,
      content: deliverable.content,
      version: deliverable.version,
      status: deliverable.status,
      mention_id: deliverable.mentionId,
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
