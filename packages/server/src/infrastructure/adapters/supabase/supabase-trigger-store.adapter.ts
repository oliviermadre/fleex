import { TriggerEntity } from '../../../domain/entities/trigger.entity.js';
import type { TriggerStorePort, ClaimedTrigger } from '../../../application/ports/trigger-store.port.js';
import type { TriggerConfig, TriggerKind, TriggerMode, TriggerRunStatus, TriggerTargetType } from '@fleex/shared';
import type { SupabaseConnection } from './connection.js';

interface TriggerRow {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  kind: string;
  config: TriggerConfig;
  description_md: string;
  target_type: string;
  target_ref: string;
  mode: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

export class SupabaseTriggerStore implements TriggerStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<TriggerEntity | null> {
    const { data, error } = await this.conn.client.from('triggers').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseTriggerStore.getById failed: ${error.message}`);
    return data ? toEntity(data as TriggerRow) : null;
  }

  async getBySlug(slug: string): Promise<TriggerEntity | null> {
    const { data, error } = await this.conn.client.from('triggers').select('*').eq('slug', slug).maybeSingle();
    if (error) throw new Error(`SupabaseTriggerStore.getBySlug failed: ${error.message}`);
    return data ? toEntity(data as TriggerRow) : null;
  }

  async getAll(): Promise<TriggerEntity[]> {
    const { data, error } = await this.conn.client.from('triggers').select('*').order('name', { ascending: true });
    if (error) throw new Error(`SupabaseTriggerStore.getAll failed: ${error.message}`);
    return (data as TriggerRow[]).map(toEntity);
  }

  async save(t: TriggerEntity): Promise<void> {
    const { error } = await this.conn.client.from('triggers').upsert(toRow(t));
    if (error) throw new Error(`SupabaseTriggerStore.save failed: ${error.message}`);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.conn.client.from('triggers').delete().eq('id', id);
    if (error) throw new Error(`SupabaseTriggerStore.delete failed: ${error.message}`);
  }

  async claimDue(now: Date, computeNext: (t: TriggerEntity, from: Date) => Date | null): Promise<ClaimedTrigger[]> {
    // Supabase has no local transaction; we emulate an atomic claim with a
    // conditional UPDATE per trigger keyed on the unchanged next_run_at. Only
    // the instance whose UPDATE matches the prior timestamp wins the claim.
    const iso = now.toISOString();
    const { data, error } = await this.conn.client
      .from('triggers')
      .select('*')
      .eq('enabled', true)
      .not('next_run_at', 'is', null)
      .lte('next_run_at', iso);
    if (error) throw new Error(`SupabaseTriggerStore.claimDue failed: ${error.message}`);

    const claimed: ClaimedTrigger[] = [];
    for (const row of (data as TriggerRow[]) ?? []) {
      const trigger = toEntity(row);
      const scheduledFor = trigger.nextRunAt ?? now;
      const next = computeNext(trigger, now);
      const updatedAt = new Date();
      const { data: updated, error: updErr } = await this.conn.client
        .from('triggers')
        .update({ next_run_at: next?.toISOString() ?? null, updated_at: updatedAt.toISOString() })
        .eq('id', trigger.id)
        .eq('next_run_at', row.next_run_at as string)
        .select('id');
      if (updErr) throw new Error(`SupabaseTriggerStore.claimDue update failed: ${updErr.message}`);
      if (updated && updated.length > 0) {
        trigger.nextRunAt = next;
        trigger.updatedAt = updatedAt;
        claimed.push({ trigger, scheduledFor });
      }
    }
    return claimed;
  }
}

function toRow(t: TriggerEntity): TriggerRow {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    emoji: t.emoji,
    description: t.description,
    kind: t.kind,
    config: t.config,
    description_md: t.descriptionMd,
    target_type: t.targetType,
    target_ref: t.targetRef,
    mode: t.mode,
    enabled: t.enabled,
    next_run_at: t.nextRunAt?.toISOString() ?? null,
    last_run_at: t.lastRunAt?.toISOString() ?? null,
    last_status: t.lastStatus,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

function toEntity(r: TriggerRow): TriggerEntity {
  return new TriggerEntity(
    r.id,
    r.name,
    r.slug,
    r.emoji,
    r.description,
    r.kind as TriggerKind,
    r.config,
    r.description_md,
    r.target_type as TriggerTargetType,
    r.target_ref,
    r.mode as TriggerMode,
    r.enabled,
    r.next_run_at ? new Date(r.next_run_at) : null,
    r.last_run_at ? new Date(r.last_run_at) : null,
    (r.last_status as TriggerRunStatus | null) ?? null,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}
