import { RoutineEntity } from '../../../domain/entities/routine.entity.js';
import { normalizeRunSubject } from '@fleex/shared';
import type { RoutineStorePort } from '../../../application/ports/routine-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { RoutineOverlapPolicy, RoutineTrigger } from '@fleex/shared';

interface Row {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string | null;
  enabled: number;
  template_id: string;
  subject: string;
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

/**
 * The trigger is stored decomposed (kind + cron + run_at + timezone) rather
 * than as a JSON blob so the future scheduler can `SELECT … WHERE enabled = 1
 * AND next_run_at <= now` without deserialising every row.
 */
function rowToTrigger(r: Row): RoutineTrigger {
  if (r.trigger_kind === 'cron' && r.cron) return { kind: 'cron', cron: r.cron, timezone: r.timezone };
  if (r.trigger_kind === 'once' && r.run_at) return { kind: 'once', runAt: r.run_at, timezone: r.timezone };
  return { kind: 'manual' };
}

export class SqliteRoutineStoreAdapter implements RoutineStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getAll(): Promise<RoutineEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM routines ORDER BY created_at DESC').all() as Row[];
    return rows.map(toEntity);
  }

  async getById(id: string): Promise<RoutineEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as Row | undefined;
    return r ? toEntity(r) : null;
  }

  async getBySlug(slug: string): Promise<RoutineEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM routines WHERE slug = ?').get(slug) as Row | undefined;
    return r ? toEntity(r) : null;
  }

  async getDue(now: Date): Promise<RoutineEntity[]> {
    const rows = this.conn.db.prepare(`
      SELECT * FROM routines
      WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `).all(now.toISOString()) as Row[];
    return rows.map(toEntity);
  }

  async getEnabled(): Promise<RoutineEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM routines WHERE enabled = 1').all() as Row[];
    return rows.map(toEntity);
  }

  async save(routine: RoutineEntity): Promise<void> {
    const t = routine.trigger;
    this.conn.db.prepare(`
      INSERT INTO routines
        (id, slug, name, emoji, description, enabled, template_id, subject,
         trigger_kind, cron, run_at, timezone, overlap_policy,
         last_run_at, last_run_id, next_run_at, created_at, updated_at)
      VALUES
        (@id, @slug, @name, @emoji, @description, @enabled, @template_id, @subject,
         @trigger_kind, @cron, @run_at, @timezone, @overlap_policy,
         @last_run_at, @last_run_id, @next_run_at, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        name = excluded.name,
        emoji = excluded.emoji,
        description = excluded.description,
        enabled = excluded.enabled,
        template_id = excluded.template_id,
        subject = excluded.subject,
        trigger_kind = excluded.trigger_kind,
        cron = excluded.cron,
        run_at = excluded.run_at,
        timezone = excluded.timezone,
        overlap_policy = excluded.overlap_policy,
        last_run_at = excluded.last_run_at,
        last_run_id = excluded.last_run_id,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at
    `).run({
      id: routine.id,
      slug: routine.slug,
      name: routine.name,
      emoji: routine.emoji,
      description: routine.description,
      enabled: routine.enabled ? 1 : 0,
      template_id: routine.templateId,
      subject: JSON.stringify(routine.subject),
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
  }

  async delete(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM routines WHERE id = ?').run(id);
  }
}

function toEntity(r: Row): RoutineEntity {
  const e = new RoutineEntity(
    r.id,
    r.slug,
    r.name,
    r.emoji,
    r.description,
    r.enabled === 1,
    r.template_id,
    normalizeRunSubject(JSON.parse(r.subject)),
    rowToTrigger(r),
    r.overlap_policy as RoutineOverlapPolicy,
    r.last_run_at ? new Date(r.last_run_at) : null,
    r.last_run_id,
    r.next_run_at ? new Date(r.next_run_at) : null,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
  return e;
}
