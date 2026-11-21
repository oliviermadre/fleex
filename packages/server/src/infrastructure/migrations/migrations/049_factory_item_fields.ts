import type { Migration } from '../types.js';

/**
 * What a source says of an item beyond what every item has (experimental Factory): a Slack channel, Gmail labels, a
 * GitHub repository. A JSON object, filled by the source's connector and filtered on by its intakes' rules (see
 * `factory/item-sources.ts`). A column added to `factory_items`, which already has its RLS policy.
 */
const migration: Migration = {
  name: '049_factory_item_fields',

  async up(ctx) {
    const json = ctx.adapter === 'sqlite' ? 'TEXT' : 'JSONB';
    await ctx.exec(`ALTER TABLE factory_items ADD COLUMN fields ${json}`);
  },

  async down(ctx) {
    await ctx.exec('ALTER TABLE factory_items DROP COLUMN fields');
  },
};

export default migration;
