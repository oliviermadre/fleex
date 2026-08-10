import { RoutineEntity } from '../../../domain/entities/routine.entity.js';
import { normalizeRunSubject } from '@fleex/shared';
import type { RoutineClaim, RoutineStorePort } from '../../../application/ports/routine-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { RoutineOverlapPolicy, RoutineTrigger } from '@fleex/shared';
import { rowToTarget, targetToColumns } from '../routine-target-mapping.js';

interface Row {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string | null;
  enabled: number;
  template_id: string | null;
  target_kind: string | null;
  target_ref: string | null;
  subject: string;
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
  webhook_enabled: number | null;
  webhook_secret: string | null;
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

  async getByWebhookSecret(secret: string): Promise<RoutineEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM routines WHERE webhook_secret = ?').get(secret) as Row | undefined;
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

  /**
   * The `next_run_at = @observed` predicate is the whole mechanism: the UPDATE
   * matches only while the row still carries the value this process read, so
   * the second writer touches nothing and learns it lost. WAL lets both
   * instances write concurrently, but SQLite still serialises the writes — the
   * losing UPDATE is evaluated against the winner's result, never against a
   * stale snapshot.
   *
   * `RETURNING` rather than the driver's affected-row count: it is the same
   * signal, expressed in SQL instead of in whatever shape the bound sqlite
   * build happens to return from `run()`.
   */
  async claimDue(claim: RoutineClaim): Promise<boolean> {
    const row = this.conn.db.prepare(`
      UPDATE routines
         SET next_run_at = @next_run_at,
             enabled = CASE WHEN @disable = 1 THEN 0 ELSE enabled END,
             last_claimed_by = @claimed_by,
             last_claimed_at = @claimed_at,
             updated_at = @claimed_at
       WHERE id = @id AND next_run_at = @observed
      RETURNING id
    `).get({
      id: claim.id,
      observed: claim.observedNextRunAt.toISOString(),
      next_run_at: claim.nextRunAt?.toISOString() ?? null,
      disable: claim.disable ? 1 : 0,
      claimed_by: claim.claimedBy,
      claimed_at: claim.claimedAt.toISOString(),
    });
    return row !== undefined && row !== null;
  }

  async rearm(id: string, nextRunAt: Date | null): Promise<void> {
    this.conn.db.prepare(
      'UPDATE routines SET next_run_at = ?, updated_at = ? WHERE id = ?',
    ).run(nextRunAt?.toISOString() ?? null, new Date().toISOString(), id);
  }

  /**
   * Deliberately does NOT write `last_claimed_by` / `last_claimed_at`: those
   * columns belong to {@link claimDue} alone. Including them here would let any
   * ordinary edit (rename, enable toggle) overwrite a claim another instance
   * had just recorded.
   */
  async save(routine: RoutineEntity): Promise<void> {
    const t = routine.trigger;
    this.conn.db.prepare(`
      INSERT INTO routines
        (id, slug, name, emoji, description, enabled, template_id, target_kind, target_ref, subject,
         trigger_kind, cron, run_at, timezone, overlap_policy, webhook_enabled, webhook_secret,
         last_run_at, last_run_id, next_run_at, created_at, updated_at)
      VALUES
        (@id, @slug, @name, @emoji, @description, @enabled, @template_id, @target_kind, @target_ref, @subject,
         @trigger_kind, @cron, @run_at, @timezone, @overlap_policy, @webhook_enabled, @webhook_secret,
         @last_run_at, @last_run_id, @next_run_at, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        name = excluded.name,
        emoji = excluded.emoji,
        description = excluded.description,
        enabled = excluded.enabled,
        template_id = excluded.template_id,
        target_kind = excluded.target_kind,
        target_ref = excluded.target_ref,
        subject = excluded.subject,
        trigger_kind = excluded.trigger_kind,
        cron = excluded.cron,
        run_at = excluded.run_at,
        timezone = excluded.timezone,
        overlap_policy = excluded.overlap_policy,
        webhook_enabled = excluded.webhook_enabled,
        webhook_secret = excluded.webhook_secret,
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
      ...targetToColumns(routine.target),
      subject: JSON.stringify(routine.subject),
      trigger_kind: t.kind,
      cron: t.kind === 'cron' ? t.cron : null,
      run_at: t.kind === 'once' ? t.runAt : null,
      timezone: t.kind === 'manual' ? 'Europe/Paris' : t.timezone,
      overlap_policy: routine.overlapPolicy,
      webhook_enabled: routine.webhookEnabled ? 1 : 0,
      webhook_secret: routine.webhookSecret,
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
    rowToTarget(r),
    normalizeRunSubject(JSON.parse(r.subject)),
    rowToTrigger(r),
    r.overlap_policy as RoutineOverlapPolicy,
    r.last_run_at ? new Date(r.last_run_at) : null,
    r.last_run_id,
    r.next_run_at ? new Date(r.next_run_at) : null,
    new Date(r.created_at),
    new Date(r.updated_at),
    r.last_claimed_by ?? null,
    r.last_claimed_at ? new Date(r.last_claimed_at) : null,
    r.webhook_enabled === 1,
    r.webhook_secret ?? null,
  );
  return e;
}
