import { DomainEventLogEntity } from '../../../domain/entities/domain-event-log.entity.js';
import type { DomainEventLogStorePort } from '../../../application/ports/domain-event-log-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface EventLogRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  instance_id: string;
  occurred_at: string;
}

/** PostgREST's max-rows cap (Supabase default) — the page size we paginate on. */
const PAGE = 1000;

function rowToEntity(r: EventLogRow): DomainEventLogEntity {
  return new DomainEventLogEntity(
    r.id,
    r.event_type,
    r.payload,
    r.instance_id,
    new Date(r.occurred_at),
  );
}

export class SupabaseDomainEventLogStore implements DomainEventLogStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async save(entry: DomainEventLogEntity): Promise<void> {
    const { error } = await this.conn.client.from('domain_event_log').upsert({
      id: entry.id,
      event_type: entry.eventType,
      payload: entry.payload,
      instance_id: entry.instanceId,
      occurred_at: entry.occurredAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseDomainEventLogStore.save failed: ${error.message}`);
  }

  async list(params: {
    limit: number;
    before?: string;
    eventType?: string;
    instanceId?: string;
    since?: Date;
    until?: Date;
  }): Promise<DomainEventLogEntity[]> {
    let cursorAt: string | null = null;
    if (params.before) {
      // Get the cursor row first
      const { data: cursorData } = await this.conn.client
        .from('domain_event_log')
        .select('occurred_at')
        .eq('id', params.before)
        .maybeSingle();
      if (cursorData) cursorAt = cursorData.occurred_at as string;
    }

    // Paginated: PostgREST caps every response at max-rows, so a single
    // `.limit(50_000)` silently returned 1000 rows — Statistics' lead time and
    // CFD only ever saw the 1000 most recent ticket moves.
    const rows: EventLogRow[] = [];
    for (let offset = 0; offset < params.limit; offset += PAGE) {
      const end = Math.min(offset + PAGE, params.limit) - 1;
      let query = this.conn.client
        .from('domain_event_log')
        .select('*')
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, end);
      if (cursorAt) query = query.lt('occurred_at', cursorAt);
      if (params.eventType) {
        query = query.or(`event_type.eq.${params.eventType},event_type.like.${params.eventType}.%`);
      }
      if (params.instanceId) query = query.eq('instance_id', params.instanceId);
      if (params.since) query = query.gte('occurred_at', params.since.toISOString());
      if (params.until) query = query.lte('occurred_at', params.until.toISOString());

      const { data, error } = await query;
      if (error) throw new Error(`SupabaseDomainEventLogStore.list failed: ${error.message}`);
      const page = data as EventLogRow[];
      rows.push(...page);
      if (page.length < end - offset + 1) break;
    }
    return rows.map(rowToEntity);
  }

  async count(): Promise<number> {
    const { count, error } = await this.conn.client
      .from('domain_event_log')
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error(`SupabaseDomainEventLogStore.count failed: ${error.message}`);
    return count ?? 0;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const { data, error } = await this.conn.client
      .from('domain_event_log')
      .delete()
      .lt('occurred_at', date.toISOString())
      .select('id');
    if (error) throw new Error(`SupabaseDomainEventLogStore.deleteOlderThan failed: ${error.message}`);
    return data?.length ?? 0;
  }
}
