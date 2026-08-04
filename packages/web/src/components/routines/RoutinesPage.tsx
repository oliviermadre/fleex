import { useEffect } from 'react';
import { useRoutineStore } from '../../stores/routineStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { RoutineDetail } from './RoutineDetail';
import { RoutineIcon } from '../../lib/primitives';

/**
 * The Routines main view. The list lives in the shared `ContentPanel` sidebar
 * (RoutinesContentPanel) like every other master/detail screen — this component
 * only renders the selected routine, so the run gets the full main-panel width.
 */
export function RoutinesPage() {
  const routines = useRoutineStore((s) => s.routines);
  const selectedId = useRoutineStore((s) => s.selectedId);
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const refreshTemplates = useWorkflowTemplateStore((s) => s.refresh);

  // The detail header names the workflow a routine runs; make sure templates
  // exist even when the sidebar mounted collapsed and never fetched them.
  useEffect(() => {
    if (templates.length === 0) void refreshTemplates();
    // Mount-only: the template store owns its own invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = routines.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      {selected ? <RoutineDetail routine={selected} /> : <SelectRoutineEmptyState />}
    </div>
  );
}

function SelectRoutineEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--theme-text-muted)]">
      <RoutineIcon size={48} strokeWidth={1} tinted={false} className="text-[var(--theme-text-faint)]" />
      <p className="text-sm">Select a routine from the list</p>
    </div>
  );
}
