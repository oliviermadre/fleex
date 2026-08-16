import { RoutineEntity } from '../../../domain/entities/routine.entity.js';
import { normalizeRunSubject } from '@fleex/shared';
import type { RoutineClaim, RoutineStorePort } from '../../../application/ports/routine-store.port.js';
import type { PgConnection } from './connection.js';
import type { RoutineOverlapPolicy, RoutineTrigger } from '@fleex/shared';
import { rowToTarget, targetToColumns } from '../routine-target-mapping.js';
import { readJson, readIso } from './pg-json.js';

/**
 * The trigger is stored decomposed (kind + cron + run_at + timezone) rather than
 * as a JSON blob so the scheduler can `SELECT … WHERE enabled AND next_run_at <=
 * now` without deserialising every row.
 *
 * `runAt` is read through {@link readIso} because `pg` hands back a `Date` for a
 * `TIMESTAMPTZ` while the domain type is an ISO string — the one place where
 * this adapter cannot mirror its SQLite twin line for line.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTrigger(r: any): RoutineTrigger {
  if (r.trigger_kind === 'cron' && r.cron) return { kind: 'cron', cron: r.cron, timezone: r.timezone };
  const runAt = readIso(r.run_at);
  if (r.trigger_kind === 'once' && runAt) return { kind: 'once', runAt, timezone: r.timezone };
  return { kind: 'manual' };
}

export class PgRoutineStore implements RoutineStorePort {
  constructor(private readonly db: PgConnection) {}

  async getAll(): Promise<RoutineEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM routines ORDER BY created_at DESC');
    return rows.map(rowToEntity);
  }

  async getById(id: string): Promise<RoutineEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM routines WHERE id = $1', [id]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<RoutineEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM routines WHERE slug = $1', [slug]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getDue(now: Date): Promise<RoutineEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM routines
        WHERE enabled = TRUE AND next_run_at IS NOT NULL AND next_run_at <= $1
        ORDER BY next_run_at ASC`,
      [now.toISOString()],
    );
    return rows.map(rowToEntity);
  }

  async getEnabled(): Promise<RoutineEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM routines WHERE enabled = TRUE');
    return rows.map(rowToEntity);
  }

  /**
   * The `next_run_at = $2` predicate is the whole mechanism: the UPDATE matches
   * only while the row still carries the value this process read, so of the N
   * instances that saw the same due routine exactly one gets a row back.
   *
   * `RETURNING` rather than the driver's `rowCount`: the same signal, expressed
   * in SQL, and identical to what the SQLite and Supabase adapters do.
   *
   * The witness is sent as a `Z`-suffixed ISO string. Postgres compares
   * `timestamptz` by instant, and the value round-trips exactly because it is
   * the one this code wrote in the first place.
   */
  async claimDue(claim: RoutineClaim): Promise<boolean> {
    const { rows } = await this.db.query(
      `UPDATE routines
          SET next_run_at = $3,
              enabled = CASE WHEN $4 THEN FALSE ELSE enabled END,
              last_claimed_by = $5,
              last_claimed_at = $6,
              updated_at = $6
        WHERE id = $1 AND next_run_at = $2
       RETURNING id`,
      [
        claim.id,
        claim.observedNextRunAt.toISOString(),
        claim.nextRunAt?.toISOString() ?? null,
        claim.disable ?? false,
        claim.claimedBy,
        claim.claimedAt.toISOString(),
      ],
    );
    return rows.length > 0;
  }

  async rearm(id: string, nextRunAt: Date | null): Promise<void> {
    await this.db.query(
      'UPDATE routines SET next_run_at = $1, updated_at = $2 WHERE id = $3',
      [nextRunAt?.toISOString() ?? null, new Date().toISOString(), id],
    );
  }

  /**
   * Deliberately does NOT write `last_claimed_by` / `last_claimed_at`: those
   * columns belong to {@link claimDue} alone, so an ordinary edit (rename,
   * enable toggle) can never overwrite a claim another instance just recorded.
   */
  async save(routine: RoutineEntity): Promise<void> {
    const t = routine.trigger;
    const target = targetToColumns(routine.target);
    await this.db.query(
      `INSERT INTO routines
         (id, slug, name, emoji, description, enabled, template_id, target_kind, target_ref, subject,
          trigger_kind, cron, run_at, timezone, overlap_policy,
          last_run_at, last_run_id, next_run_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO UPDATE SET
         slug = $2,
         name = $3,
         emoji = $4,
         description = $5,
         enabled = $6,
         template_id = $7,
         target_kind = $8,
         target_ref = $9,
         subject = $10,
         trigger_kind = $11,
         cron = $12,
         run_at = $13,
         timezone = $14,
         overlap_policy = $15,
         last_run_at = $16,
         last_run_id = $17,
         next_run_at = $18,
         updated_at = $20`,
      [
        routine.id,
        routine.slug,
        routine.name,
        routine.emoji,
        routine.description,
        routine.enabled,
        target.template_id,
        target.target_kind,
        target.target_ref,
        JSON.stringify(routine.subject),
        t.kind,
        t.kind === 'cron' ? t.cron : null,
        t.kind === 'once' ? t.runAt : null,
        t.kind === 'manual' ? 'Europe/Paris' : t.timezone,
        routine.overlapPolicy,
        routine.lastRunAt?.toISOString() ?? null,
        routine.lastRunId,
        routine.nextRunAt?.toISOString() ?? null,
        routine.createdAt.toISOString(),
        routine.updatedAt.toISOString(),
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM routines WHERE id = $1', [id]);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntity(r: any): RoutineEntity {
  return new RoutineEntity(
    r.id,
    r.slug,
    r.name,
    r.emoji,
    r.description,
    Boolean(r.enabled),
    rowToTarget(r),
    normalizeRunSubject(readJson(r.subject)),
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
