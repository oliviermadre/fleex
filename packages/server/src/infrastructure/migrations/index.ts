import type { Migration } from './types.js';
import migration001 from './migrations/001_initial_schema.js';
import migration002 from './migrations/002_add_skills_table.js';
import migration003 from './migrations/003_add_panels_table.js';
import migration004 from './migrations/004_add_panel_orchestrator_persona.js';
import migration005 from './migrations/005_add_execution_mode.js';
import migration006 from './migrations/006_add_execution_metrics.js';
import migration007 from './migrations/007_add_execution_model_and_token_breakdown.js';
import migration008 from './migrations/003_add_files_table.js';
import migration009 from './migrations/009_add_deliverable_excluded_from_context.js';

/**
 * Ordered array of all migrations.
 * Add new migrations here in sequence.
 */
export const allMigrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
];
