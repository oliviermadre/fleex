import type { Migration } from '../types.js';

const migration: Migration = {
  name: '006_add_execution_metrics',

  async up(ctx) {

    const cols = [
      `ALTER TABLE agent_event_executions ADD COLUMN effective_mode TEXT`,
      `ALTER TABLE agent_event_executions ADD COLUMN duration_ms INTEGER`,
      `ALTER TABLE agent_event_executions ADD COLUMN cost_usd REAL`,
      `ALTER TABLE agent_event_executions ADD COLUMN input_tokens INTEGER`,
      `ALTER TABLE agent_event_executions ADD COLUMN output_tokens INTEGER`,
    ];
    for (const sql of cols) {
      const dialectSql = ctx.dialect({ sqlite: sql, pgsql: sql, supabase: sql });
      if (dialectSql) await ctx.exec(dialectSql);
    }
  },

  async down(ctx) {
  },
};

export default migration;
