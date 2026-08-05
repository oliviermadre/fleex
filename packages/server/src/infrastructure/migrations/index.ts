import type { Migration } from './types.js';
import migration001 from './migrations/001_initial_schema.js';
import migration002 from './migrations/002_add_skills_table.js';
import migration003 from './migrations/003_add_panels_table.js';
import migration004 from './migrations/004_add_panel_orchestrator_persona.js';
import migration005 from './migrations/005_add_execution_mode.js';
import migration006 from './migrations/006_add_execution_metrics.js';
import migration007 from './migrations/007_add_execution_model_and_token_breakdown.js';
import migration008 from './migrations/003_add_files_table.js';
import migration009 from './migrations/008_add_ticket_archived_at.js';
import migration010 from './migrations/009_remove_board_repository.js';
import migration011 from './migrations/010_ticket_groups_and_relationships.js';
import migration012 from './migrations/011_ticket_groups_rls_policies.js';
import migration013 from './migrations/012_ticket_group_boards.js';
import migration014 from './migrations/013_add_ticket_type.js';
import migration015 from './migrations/014_add_ticket_first_doing_at.js';
import migration016 from './migrations/015_migrate_ticket_types.js';
import migration017 from './migrations/016_global_display_id.js';
import migration018 from './migrations/017_add_session_hook_status.js';
import migration019 from './migrations/018_add_workflows.js';
import migration020 from './migrations/019_fix_workflow_templates_enabled_type.js';
import migration021 from './migrations/020_supabase_user_kv.js';
import migration022 from './migrations/021_add_ticket_execution_config.js';
import migration023 from './migrations/022_add_execution_effort_and_fast.js';
import migration024 from './migrations/023_add_execution_source.js';
import migration025 from './migrations/024_add_execution_output_refs.js';
import migration026 from './migrations/025_add_routines.js';
import migration027 from './migrations/026_add_workflow_run_parent.js';
import migration028 from './migrations/027_routine_primitive_targets.js';
import migration029 from './migrations/028_deliverable_step_anchor.js';
import migration030 from './migrations/029_deliverable_search_view.js';
import migration031 from './migrations/030_deliverable_emitter.js';
import migration032 from './migrations/031_deliverable_origin_kind.js';
import migration033 from './migrations/032_routine_scheduler_claims.js';

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
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
  migration026,
  migration027,
  migration028,
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
];
