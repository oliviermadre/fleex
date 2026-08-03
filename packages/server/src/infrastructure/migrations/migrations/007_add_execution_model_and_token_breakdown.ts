import type { Migration } from '../types.js';

const migration: Migration = {
  name: '007_add_execution_model_and_token_breakdown',

  async up(ctx) {

    const cols = [
      `ALTER TABLE agent_event_executions ADD COLUMN model TEXT`,
      `ALTER TABLE agent_event_executions ADD COLUMN cache_read_tokens INTEGER`,
      `ALTER TABLE agent_event_executions ADD COLUMN cache_creation_tokens INTEGER`,
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
