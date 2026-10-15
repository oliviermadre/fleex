import type { Migration } from '../types.js';

/**
 * Prefix index on `domain_event_log.event_type` for Postgres / Supabase.
 *
 * `DomainEventLogStore.list({ eventType })` filters on
 * `event_type = X OR event_type LIKE 'X.%'`. Under a non-C collation the
 * existing btree index cannot serve the LIKE, so every call seq-scanned the
 * whole log (~38k rows): 1.4 s for a rare prefix, warm. The notification bell
 * fires one such query per event-type root, in parallel, on every app load —
 * alongside the Stats reads — and they crossed the `anon` role's 3 s
 * statement_timeout ("SupabaseDomainEventLogStore.list failed: canceling
 * statement due to statement timeout"). With `text_pattern_ops` the planner
 * answers both branches from an index (measured: 1456 ms → 3 ms).
 *
 * SQLite is left alone: local logs are small, and its LIKE optimisation has
 * different preconditions (case-sensitive LIKE, BINARY collation).
 */
const migration: Migration = {
  name: '038_domain_event_log_prefix_index',

  async up(ctx) {
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec(
      'CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type_prefix ON domain_event_log (event_type text_pattern_ops)',
    );
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec('DROP INDEX IF EXISTS idx_domain_event_log_event_type_prefix');
  },
};

export default migration;
