import type { Migration } from './types.js';
import migration001 from './migrations/001_initial_schema.js';
import migration002 from './migrations/002_add_skills_table.js';
import migration003 from './migrations/003_add_panels_table.js';
import migration004 from './migrations/004_add_panel_orchestrator_persona.js';

/**
 * Ordered array of all migrations.
 * Add new migrations here in sequence.
 */
export const allMigrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
];
