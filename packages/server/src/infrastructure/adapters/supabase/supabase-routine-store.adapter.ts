import { RoutineEntity } from '../../../domain/entities/routine.entity.js';
import { normalizeRunSubject } from '@fleex/shared';
import type { RoutineClaim, RoutineStorePort } from '../../../application/ports/routine-store.port.js';
import type { SupabaseConnection } from './connection.js';
import type { RoutineOverlapPolicy, RoutineTrigger } from '@fleex/shared';
import { rowToTarget, targetToColumns } from '../routine-target-mapping.js';

interface Row {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string | null;
  enabled: boolean;
  template_id: string | null;
  target_kind: string | null;
  target_ref: string | null;
  subject: unknown;
  trigger_kind: string;
  cron: string | null;
  run_at: string | null;
  timezone: string;
  overlap_policy: string;
  last_run_at: string | null;
  last_run_id: string | null;
  next_run_at: string | null;
  last_claimed_by: string | null;
  last_claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTrigger(r: Row): RoutineTrigger {
  if (r.trigger_kind === 'cron' && r.cron) return { kind: 'cron', cron: r.cron, timezone: r.timezone };
  if (r.trigger_kind === 'once' && r.run_at) return { kind: 'once', runAt: r.run_at, timezone: r.timezone };
  return { kind: 'manual' };
}

function toEntity(r: Row): RoutineEntity {
  return new RoutineEntity(
    r.id,
    r.slug,
    r.name,
    r.emoji,
    r.description,
    r.enabled,
    rowToTarget(r),
    normalizeRunSubject(r.subject),
    rowToTrigger(r),
    r.overlap_policy as RoutineOverlapPolicy,
    r.last_run_at ? new Date(r.last_run_at) : null,
    r.last_run_id,
    r.next_run_at ? new Date(r.next_run_at) : null,
    new Date(r.created_at),
    new Date(r.updated_at),
    r.last_claimed_by ?? null,
    r.last_claimed_at ? new Date(r.last_claimed_at) : null,
  );
}

export class SupabaseRoutineStore implements RoutineStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getAll(): Promise<RoutineEntity[]> {
    const { data, error } = await this.conn.client
      .from('routines')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseRoutineStore.getAll failed: ${error.message}`);
    return (data as Row[]).map(toEntity);
  }

  async getById(id: string): Promise<RoutineEntity | null> {
    const { data, error } = await this.conn.client
      .from('routines').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseRoutineStore.getById failed: ${error.message}`);
    return data ? toEntity(data as Row) : null;
  }

  async getBySlug(slug: string): Promise<RoutineEntity | null> {
    const { data, error } = await this.conn.client
      .from('routines').select('*').eq('slug', slug).maybeSingle();
    if (error) throw new Error(`SupabaseRoutineStore.getBySlug failed: ${error.message}`);
    return data ? toEntity(data as Row) : null;
  }

  async getDue(now: Date): Promise<RoutineEntity[]> {
    const { data, error } = await this.conn.client
      .from('routines')
      .select('*')
      .eq('enabled', true)
      .not('next_run_at', 'is', null)
      .lte('next_run_at', now.toISOString())
      .order('next_run_at', { ascending: true });
    if (error) throw new Error(`SupabaseRoutineStore.getDue failed: ${error.message}`);
    return (data as Row[]).map(toEntity);
  }

  async getEnabled(): Promise<RoutineEntity[]> {
    const { data, error } = await this.conn.client
      .from('routines').select('*').eq('enabled', true);
    if (error) throw new Error(`SupabaseRoutineStore.getEnabled failed: ${error.message}`);
    return (data as Row[]).map(toEntity);
  }

  /**
   * The CAS is the pair of `.eq()` filters: the UPDATE matches only while the
   * row still holds the `next_run_at` this process read, so of the N instances
   * that saw the same due routine exactly one gets a row back.
   *
   * `.select()` is what makes the outcome observable — supabase-js reports no
   * error for an UPDATE that matched nothing, so without it a lost race would
   * look identical to a won one.
   *
   * The instant is sent as a `Z`-suffixed ISO string: Postgres compares
   * timestamptz by instant, and the value round-trips exactly because it is the
   * one we wrote in the first place.
   */
  async claimDue(claim: RoutineClaim): Promise<boolean> {
    const patch: Record<string, unknown> = {
      next_run_at: claim.nextRunAt?.toISOString() ?? null,
      last_claimed_by: claim.claimedBy,
      last_claimed_at: claim.claimedAt.toISOString(),
      updated_at: claim.claimedAt.toISOString(),
    };
    if (claim.disable) patch['enabled'] = false;

    const { data, error } = await this.conn.client
      .from('routines')
      .update(patch)
      .eq('id', claim.id)
      .eq('next_run_at', claim.observedNextRunAt.toISOString())
      .select('id');
    if (error) throw new Error(`SupabaseRoutineStore.claimDue failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async rearm(id: string, nextRunAt: Date | null): Promise<void> {
    const { error } = await this.conn.client
      .from('routines')
      .update({ next_run_at: nextRunAt?.toISOString() ?? null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`SupabaseRoutineStore.rearm failed: ${error.message}`);
  }

  /**
   * Deliberately does NOT write `last_claimed_by` / `last_claimed_at`: those
   * columns belong to {@link claimDue} alone, so an ordinary edit can never
   * overwrite a claim another instance just recorded.
   */
  async save(routine: RoutineEntity): Promise<void> {
    const t = routine.trigger;
    const { error } = await this.conn.client.from('routines').upsert({
      id: routine.id,
      slug: routine.slug,
      name: routine.name,
      emoji: routine.emoji,
      description: routine.description,
      enabled: routine.enabled,
      ...targetToColumns(routine.target),
      subject: routine.subject,
      trigger_kind: t.kind,
      cron: t.kind === 'cron' ? t.cron : null,
      run_at: t.kind === 'once' ? t.runAt : null,
      timezone: t.kind === 'manual' ? 'Europe/Paris' : t.timezone,
      overlap_policy: routine.overlapPolicy,
      last_run_at: routine.lastRunAt?.toISOString() ?? null,
      last_run_id: routine.lastRunId,
      next_run_at: routine.nextRunAt?.toISOString() ?? null,
      created_at: routine.createdAt.toISOString(),
      updated_at: routine.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseRoutineStore.save failed: ${error.message}`);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.conn.client.from('routines').delete().eq('id', id);
    if (error) throw new Error(`SupabaseRoutineStore.delete failed: ${error.message}`);
  }
}
