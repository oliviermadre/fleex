import { TriggerEntity } from '../../../domain/entities/trigger.entity.js';
import type { TriggerStorePort, ClaimedTrigger } from '../../../application/ports/trigger-store.port.js';
import type { TriggerConfig, TriggerKind, TriggerMode, TriggerRunStatus, TriggerTargetType } from '@fleex/shared';
import type { SqliteConnection } from './connection.js';

interface Row {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  kind: string;
  config: string;
  description_md: string;
  target_type: string;
  target_ref: string;
  mode: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteTriggerStoreAdapter implements TriggerStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<TriggerEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as Row | undefined;
    return r ? toEntity(r) : null;
  }

  async getBySlug(slug: string): Promise<TriggerEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM triggers WHERE slug = ?').get(slug) as Row | undefined;
    return r ? toEntity(r) : null;
  }

  async getAll(): Promise<TriggerEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM triggers ORDER BY name ASC').all() as Row[];
    return rows.map(toEntity);
  }

  async save(t: TriggerEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO triggers
        (id, name, slug, emoji, description, kind, config, description_md, target_type, target_ref,
         mode, enabled, next_run_at, last_run_at, last_status, created_at, updated_at)
      VALUES
        (@id, @name, @slug, @emoji, @description, @kind, @config, @description_md, @target_type, @target_ref,
         @mode, @enabled, @next_run_at, @last_run_at, @last_status, @created_at, @updated_at)
    `).run(toRow(t));
  }

  async delete(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM triggers WHERE id = ?').run(id);
  }

  async claimDue(now: Date, computeNext: (t: TriggerEntity, from: Date) => Date | null): Promise<ClaimedTrigger[]> {
    const iso = now.toISOString();
    // The body runs synchronously (no await between SELECT and the UPDATEs), so
    // within a single process it is effectively atomic — no other claimDue can
    // interleave. The conditional UPDATE on the prior next_run_at also makes the
    // claim safe across the (unusual) multi-process SQLite case.
    const rows = this.conn.db
      .prepare('SELECT * FROM triggers WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?')
      .all(iso) as Row[];
    const claimed: ClaimedTrigger[] = [];
    for (const row of rows) {
      const trigger = toEntity(row);
      const scheduledFor = trigger.nextRunAt ?? now;
      const next = computeNext(trigger, now);
      const updatedAt = new Date();
      this.conn.db
        .prepare('UPDATE triggers SET next_run_at = ?, updated_at = ? WHERE id = ? AND next_run_at = ?')
        .run(next?.toISOString() ?? null, updatedAt.toISOString(), trigger.id, row.next_run_at);
      trigger.nextRunAt = next;
      trigger.updatedAt = updatedAt;
      claimed.push({ trigger, scheduledFor });
    }
    return claimed;
  }
}

function toRow(t: TriggerEntity): Row {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    emoji: t.emoji,
    description: t.description,
    kind: t.kind,
    config: JSON.stringify(t.config),
    description_md: t.descriptionMd,
    target_type: t.targetType,
    target_ref: t.targetRef,
    mode: t.mode,
    enabled: t.enabled ? 1 : 0,
    next_run_at: t.nextRunAt?.toISOString() ?? null,
    last_run_at: t.lastRunAt?.toISOString() ?? null,
    last_status: t.lastStatus,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

function toEntity(r: Row): TriggerEntity {
  return new TriggerEntity(
    r.id,
    r.name,
    r.slug,
    r.emoji,
    r.description,
    r.kind as TriggerKind,
    JSON.parse(r.config) as TriggerConfig,
    r.description_md,
    r.target_type as TriggerTargetType,
    r.target_ref,
    r.mode as TriggerMode,
    r.enabled === 1,
    r.next_run_at ? new Date(r.next_run_at) : null,
    r.last_run_at ? new Date(r.last_run_at) : null,
    (r.last_status as TriggerRunStatus | null) ?? null,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}
