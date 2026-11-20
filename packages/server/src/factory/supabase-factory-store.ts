import type { SupabaseConnection } from '../infrastructure/adapters/supabase/connection.js';
import type { FactoryStorePort } from './factory-store.port.js';
import type { FactoryFloorRow, FactoryLayout, FactoryRunRow, FactorySettings, FactoryTicketRow, FactoryTicketState } from './types.js';
import { runFromRow } from './sqlite-factory-store.js';

interface FloorRow { id: string; name: string; layout: FactoryLayout; settings: FactorySettings; created_at: string; updated_at: string }
interface TicketRow { ticket_id: string; floor_id: string; machine_id: string | null; state: FactoryTicketState; created_at: string; updated_at: string }
type RunRow = Parameters<typeof runFromRow>[0];

/** A machine-run executor that starts an agent: what the hourly limit counts. */
const COUNTED = ['agent', 'skill', 'panel'];

export class SupabaseFactoryStore implements FactoryStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  private fail(op: string, message: string): never { throw new Error(`SupabaseFactoryStore.${op} failed: ${message}`); }

  async getFloor(id: string): Promise<FactoryFloorRow | null> {
    const { data, error } = await this.conn.client.from('factory_floors').select('*').eq('id', id).maybeSingle();
    if (error) this.fail('getFloor', error.message);
    const r = data as FloorRow | null;
    return r ? { id: r.id, name: r.name, layout: r.layout, settings: r.settings, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() } : null;
  }

  async saveFloor(f: FactoryFloorRow): Promise<void> {
    const { error } = await this.conn.client.from('factory_floors').upsert({ id: f.id, name: f.name, layout: f.layout, settings: f.settings, created_at: f.createdAt, updated_at: f.updatedAt });
    if (error) this.fail('saveFloor', error.message);
  }

  async listTickets(floorId: string): Promise<FactoryTicketRow[]> {
    const { data, error } = await this.conn.client.from('factory_tickets').select('*').eq('floor_id', floorId).order('created_at', { ascending: true });
    if (error) this.fail('listTickets', error.message);
    return (data as TicketRow[]).map((r) => ({ ticketId: r.ticket_id, floorId: r.floor_id, machineId: r.machine_id, state: r.state, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() }));
  }

  async saveTicket(t: FactoryTicketRow): Promise<void> {
    const { error } = await this.conn.client.from('factory_tickets').upsert({ ticket_id: t.ticketId, floor_id: t.floorId, machine_id: t.machineId, state: t.state, created_at: t.createdAt, updated_at: t.updatedAt });
    if (error) this.fail('saveTicket', error.message);
  }

  async removeTicket(ticketId: string): Promise<void> {
    const { error } = await this.conn.client.from('factory_tickets').delete().eq('ticket_id', ticketId);
    if (error) this.fail('removeTicket', error.message);
  }

  async listManagedTicketIds(): Promise<string[]> {
    const { data, error } = await this.conn.client.from('factory_tickets').select('ticket_id');
    if (error) this.fail('listManagedTicketIds', error.message);
    return (data as { ticket_id: string }[]).map((r) => r.ticket_id);
  }

  async saveRun(r: FactoryRunRow): Promise<void> {
    const { error } = await this.conn.client.from('factory_runs').upsert({
      id: r.id, ticket_id: r.ticketId, floor_id: r.floorId, machine_id: r.machineId, machine_name: r.machineName, executor: r.executor, status: r.status,
      outcome: r.outcome, execution_id: r.executionId, error: r.error, started_at: r.startedAt, finished_at: r.finishedAt,
    });
    if (error) this.fail('saveRun', error.message);
  }

  async listRunsByTicket(ticketId: string): Promise<FactoryRunRow[]> {
    const { data, error } = await this.conn.client.from('factory_runs').select('*').eq('ticket_id', ticketId).order('started_at', { ascending: true });
    if (error) this.fail('listRunsByTicket', error.message);
    return (data as RunRow[]).map(runFromRow);
  }

  async listRecentRuns(floorId: string, limit: number, machineId?: string): Promise<FactoryRunRow[]> {
    let q = this.conn.client.from('factory_runs').select('*').eq('floor_id', floorId);
    if (machineId) q = q.eq('machine_id', machineId);
    const { data, error } = await q.order('started_at', { ascending: false }).limit(limit);
    if (error) this.fail('listRecentRuns', error.message);
    return (data as RunRow[]).map(runFromRow);
  }

  async listRunsSince(floorId: string, sinceIso: string): Promise<FactoryRunRow[]> {
    const { data, error } = await this.conn.client.from('factory_runs').select('*').eq('floor_id', floorId)
      .or(`started_at.gte.${sinceIso},finished_at.gte.${sinceIso}`).order('started_at', { ascending: true }).limit(10000);
    if (error) this.fail('listRunsSince', error.message);
    return (data as RunRow[]).map(runFromRow);
  }

  async countRunsSince(floorId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.conn.client.from('factory_runs').select('id', { count: 'exact', head: true }).eq('floor_id', floorId).gte('started_at', sinceIso).in('executor', COUNTED);
    if (error) this.fail('countRunsSince', error.message);
    return count ?? 0;
  }

  async interruptRunningRuns(nowIso: string): Promise<FactoryRunRow[]> {
    const { data, error } = await this.conn.client.from('factory_runs').update({ status: 'interrupted', finished_at: nowIso }).eq('status', 'running').select('*');
    if (error) this.fail('interruptRunningRuns', error.message);
    return (data as RunRow[]).map(runFromRow);
  }
}
