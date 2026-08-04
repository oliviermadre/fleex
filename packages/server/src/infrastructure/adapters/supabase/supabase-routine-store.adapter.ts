import { RoutineEntity } from '../../../domain/entities/routine.entity.js';
import { normalizeRunSubject } from '@fleex/shared';
import type { RoutineStorePort } from '../../../application/ports/routine-store.port.js';
import type { SupabaseConnection } from './connection.js';
import type { RoutineOverlapPolicy, RoutineTrigger } from '@fleex/shared';

interface Row {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string | null;
  enabled: boolean;
  template_id: string;
  subject: unknown;
  trigger_kind: string;
  cron: string | null;
  run_at: string | null;
  timezone: string;
  overlap_policy: string;
  last_run_at: string | null;
  last_run_id: string | null;
  next_run_at: string | null;
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
    r.template_id,
    normalizeRunSubject(r.subject),
    rowToTrigger(r),
    r.overlap_policy as RoutineOverlapPolicy,
    r.last_run_at ? new Date(r.last_run_at) : null,
    r.last_run_id,
    r.next_run_at ? new Date(r.next_run_at) : null,
    new Date(r.created_at),
    new Date(r.updated_at),
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

  async save(routine: RoutineEntity): Promise<void> {
    const t = routine.trigger;
    const { error } = await this.conn.client.from('routines').upsert({
      id: routine.id,
      slug: routine.slug,
      name: routine.name,
      emoji: routine.emoji,
      description: routine.description,
      enabled: routine.enabled,
      template_id: routine.templateId,
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
