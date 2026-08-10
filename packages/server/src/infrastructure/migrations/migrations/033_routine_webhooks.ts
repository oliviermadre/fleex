import type { Migration } from '../types.js';

/**
 * Webhooks as an *additive* property of a routine — not a trigger kind.
 *
 * A routine keeps its base trigger (manual / once / cron) and may additionally
 * expose a capability URL (`POST /api/hooks/<secret>`) that fires it from the
 * outside, payload included. Storing the flag and the secret next to the
 * trigger columns (rather than replacing `trigger_kind`) is what lets
 * "cron 9AM as a safety net + webhook for near-real-time" be one routine.
 *
 * - `webhook_secret` is the whole auth model: a 256-bit token that is both the
 *   URL and the lookup key. The unique index makes the lookup O(1) and
 *   guarantees no two routines ever share a URL. Nullable — SQLite and
 *   Postgres both allow multiple NULLs under a unique index, so routines
 *   without a webhook cost nothing.
 * - The secret survives `webhook_enabled` flipping off: disabling must not
 *   invalidate the URL a sender has already configured, or re-enabling would
 *   mean re-plumbing every external system.
 * - `workflow_runs.trigger_payload` persists the delivered body on the run so
 *   step retries re-read the exact payload the webhook carried.
 */
const migration: Migration = {
  name: '033_routine_webhooks',

  async up(ctx) {
    const jsonType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'JSONB', supabase: 'JSONB' });
    const boolType = ctx.dialect({ sqlite: 'INTEGER', pgsql: 'BOOLEAN', supabase: 'BOOLEAN' });
    const boolFalseDefault = ctx.dialect({ sqlite: 'DEFAULT 0', pgsql: 'DEFAULT FALSE', supabase: 'DEFAULT FALSE' });

    for (const col of [
      `webhook_enabled ${boolType} ${boolFalseDefault}`,
      'webhook_secret TEXT',
    ]) {
      try {
        await ctx.exec(`ALTER TABLE routines ADD COLUMN ${col}`);
      } catch {
        // Column already exists (idempotent re-run).
      }
    }

    await ctx.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_routines_webhook_secret ON routines(webhook_secret)',
    );

    try {
      await ctx.exec(`ALTER TABLE workflow_runs ADD COLUMN trigger_payload ${jsonType}`);
    } catch {
      // Column already exists (idempotent re-run).
    }

    // PostgREST caches the schema; without this the first webhook delivery
    // would 400 on an unknown column instead of simply firing.
    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP INDEX IF EXISTS idx_routines_webhook_secret');
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE routines DROP COLUMN IF EXISTS webhook_enabled');
      await ctx.exec('ALTER TABLE routines DROP COLUMN IF EXISTS webhook_secret');
      await ctx.exec('ALTER TABLE workflow_runs DROP COLUMN IF EXISTS trigger_payload');
      if (ctx.adapter === 'supabase') await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
    // SQLite: columns left in place — dropping them would mean the full table
    // rebuild migration 025 documents, and unread nullable columns are inert.
  },
};

export default migration;
