import type { RoutineTarget } from '@fleex/shared';

/**
 * Column mapping for a routine's target, shared by the SQLite and Supabase
 * adapters so the two cannot drift.
 *
 * A workflow target keeps its ref in `template_id` (preserving the FK and its
 * ON DELETE CASCADE); primitive targets live in `target_ref`. Rows written
 * before migration 027 have no `target_kind` and read back as workflow.
 */
export function rowToTarget(r: { template_id: string | null; target_kind: string | null; target_ref: string | null }): RoutineTarget {
  const kind = r.target_kind === 'agent' || r.target_kind === 'skill' || r.target_kind === 'panel'
    ? r.target_kind : 'workflow';
  return { kind, ref: (kind === 'workflow' ? r.template_id : r.target_ref) ?? '' };
}

export function targetToColumns(target: RoutineTarget): { template_id: string | null; target_kind: string; target_ref: string | null } {
  return {
    template_id: target.kind === 'workflow' ? target.ref : null,
    target_kind: target.kind,
    target_ref: target.kind === 'workflow' ? null : target.ref,
  };
}
