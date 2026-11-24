import type { SupabaseConnection } from '../infrastructure/adapters/supabase/connection.js';
import type { FactoryStorePort } from './factory-store.port.js';
import type { FactoryFloorRow, FactoryItemRow, FactoryLayout, FactoryRunRow, FactorySettings, FactoryTicketRow, FactoryTicketState, IntakePullRow, ItemBody } from './types.js';
import { itemFromRow, itemToRow, pullFromRow, pullToRow, runFromRow, type IntakePullDbRow, type ItemDbRow } from './sqlite-factory-store.js';

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

  async listItems(floorId: string): Promise<FactoryItemRow[]> {
    const { data, error } = await this.conn.client.from('factory_items').select('*').eq('floor_id', floorId).is('archived_at', null).order('created_at', { ascending: true });
    if (error) this.fail('listItems', error.message);
    return (data as ItemDbRow[]).map(itemFromRow);
  }

  async getItemByKey(source: string, sourceKey: string): Promise<FactoryItemRow | null> {
    const { data, error } = await this.conn.client.from('factory_items').select('*').eq('source', source).eq('source_key', sourceKey).maybeSingle();
    if (error) this.fail('getItemByKey', error.message);
    return data ? itemFromRow(data as ItemDbRow) : null;
  }

  async saveItem(i: FactoryItemRow): Promise<void> {
    const { error } = await this.conn.client.from('factory_items').upsert(itemToRow(i, (v) => v));
    if (error) this.fail('saveItem', error.message);
  }

  async listExitItems(floorId: string, machineId: string | null, sinceIso: string): Promise<FactoryItemRow[]> {
    const base = this.conn.client.from('factory_items').select('*').eq('floor_id', floorId);
    const { data, error } = await (machineId ? base.eq('machine_id', machineId) : base.not('machine_id', 'is', null)).eq('archived_reason', 'exit').gte('archived_at', sinceIso).order('archived_at', { ascending: false }).limit(1000);
    if (error) this.fail('listExitItems', error.message);
    return (data as ItemDbRow[]).map(itemFromRow);
  }

  async saveItemBody(itemId: string, b: ItemBody): Promise<void> {
    const { error } = await this.conn.client.from('factory_item_bodies').upsert({ item_id: itemId, text: b.text, html: b.html, updated_at: new Date().toISOString() }, { onConflict: 'item_id' });
    if (error) this.fail('saveItemBody', error.message);
  }

  async getItemBody(itemId: string): Promise<ItemBody | null> {
    const { data, error } = await this.conn.client.from('factory_item_bodies').select('text, html').eq('item_id', itemId).maybeSingle();
    if (error) this.fail('getItemBody', error.message);
    return data ? { text: (data as ItemBody).text, html: (data as ItemBody).html } : null;
  }

  async countDropped(floorId: string, sinceIso: string): Promise<Record<string, number>> {
    const { data, error } = await this.conn.client.from('factory_items').select('intake_id').eq('floor_id', floorId).eq('archived_reason', 'dropped').gte('archived_at', sinceIso).limit(20000);
    if (error) this.fail('countDropped', error.message);
    const out: Record<string, number> = {};
    for (const r of data as { intake_id: string | null }[]) if (r.intake_id) out[r.intake_id] = (out[r.intake_id] ?? 0) + 1;
    return out;
  }

  async listIntakePulls(floorId: string): Promise<IntakePullRow[]> {
    const { data, error } = await this.conn.client.from('factory_intake_pulls').select('*').eq('floor_id', floorId);
    if (error) this.fail('listIntakePulls', error.message);
    return (data as IntakePullDbRow[]).map(pullFromRow);
  }

  async saveIntakePull(r: IntakePullRow): Promise<void> {
    const { error } = await this.conn.client.from('factory_intake_pulls').upsert(pullToRow(r), { onConflict: 'intake_id' });
    if (error) this.fail('saveIntakePull', error.message);
  }

  async saveRun(r: FactoryRunRow): Promise<void> {
    const { error } = await this.conn.client.from('factory_runs').upsert({
      id: r.id, ticket_id: r.ticketId, floor_id: r.floorId, machine_id: r.machineId, machine_name: r.machineName, executor: r.executor, status: r.status,
      outcome: r.outcome, execution_id: r.executionId, error: r.error, started_at: r.startedAt, finished_at: r.finishedAt,
    });
    if (error) this.fail('saveRun', error.message);
  }

  async saveItemRun(r: FactoryRunRow): Promise<void> {
    const { error } = await this.conn.client.from('factory_item_runs').upsert({
      id: r.id, item_id: r.ticketId, floor_id: r.floorId, machine_id: r.machineId, machine_name: r.machineName, executor: r.executor, status: r.status,
      outcome: r.outcome, execution_id: r.executionId, error: r.error, reply: r.reply ?? null, deliverable_id: r.deliverableId ?? null, started_at: r.startedAt, finished_at: r.finishedAt,
    });
    if (error) this.fail('saveItemRun', error.message);
  }

  async listItemRuns(itemId: string): Promise<FactoryRunRow[]> {
    const { data, error } = await this.conn.client.from('factory_item_runs').select('*').eq('item_id', itemId).order('started_at', { ascending: true });
    if (error) this.fail('listItemRuns', error.message);
    return (data as Parameters<typeof runFromRow>[0][]).map(runFromRow);
  }

  async listRecentItemRuns(floorId: string, limit: number, machineId?: string): Promise<FactoryRunRow[]> {
    let q = this.conn.client.from('factory_item_runs').select('*, factory_items(title, source)').eq('floor_id', floorId);
    if (machineId) q = q.eq('machine_id', machineId);
    const { data, error } = await q.order('started_at', { ascending: false }).limit(limit);
    if (error) this.fail('listRecentItemRuns', error.message);
    return (data as (RunRow & { item_id: string; factory_items: { title: string; source: string } | null })[]).map((r) => ({
      ...runFromRow(r), item: r.factory_items ? { title: r.factory_items.title, source: r.factory_items.source as FactoryItemRow['source'] } : null,
    }));
  }

  async listItemRunsSince(floorId: string, sinceIso: string): Promise<FactoryRunRow[]> {
    const { data, error } = await this.conn.client.from('factory_item_runs').select('*').eq('floor_id', floorId).or(`started_at.gte.${sinceIso},finished_at.gte.${sinceIso}`).order('started_at', { ascending: true }).limit(10000);
    if (error) this.fail('listItemRunsSince', error.message);
    return (data as (RunRow & { item_id: string })[]).map(runFromRow);
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
    const items = await this.conn.client.from('factory_item_runs').update({ status: 'interrupted', finished_at: nowIso }).eq('status', 'running').select('*');
    if (items.error) this.fail('interruptRunningRuns', items.error.message);
    return [...(data as RunRow[]), ...(items.data as RunRow[])].map(runFromRow);
  }
}
