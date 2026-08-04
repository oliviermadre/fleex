import { useEffect, useState } from 'react';
import { useRoutineStore } from '../../stores/routineStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { RoutineDetail } from './RoutineDetail';
import { RoutineEditor } from './RoutineEditor';
import type { RoutineListItem as RoutineListItemDto } from '../../services/api';
import { cn } from '../../lib/cn';

/**
 * The Routines screen — the single home for every workflow execution that has
 * no ticket. Deliberately a master/detail page rather than a new "run" view:
 * the PRD's binding decision is one new concept, one new screen, and the run
 * itself is rendered by the existing WorkflowRunView inside the detail.
 */
export function RoutinesPage() {
  const { routines, loading, error, selectedId, load, select } = useRoutineStore();
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const refreshTemplates = useWorkflowTemplateStore((s) => s.refresh);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void load();
    if (templates.length === 0) void refreshTemplates();
    // Mount-only: the stores own their own invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = routines.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="w-72 shrink-0 border-r border-[var(--theme-border)] flex flex-col min-h-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border)]">
          <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Routines</span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-xs px-2 py-1 rounded bg-[var(--theme-accent)] text-[var(--theme-accent-contrast)]"
          >
            + New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-4 py-3 text-xs text-[var(--theme-text-faint)]">Loading…</p>}
          {error && <p className="px-4 py-3 text-xs text-[var(--theme-danger)]">{error}</p>}
          {!loading && routines.length === 0 && (
            <p className="px-4 py-3 text-xs text-[var(--theme-text-faint)]">
              No routine yet. A routine runs a workflow on a repo, a brief, or nothing at all — no ticket needed.
            </p>
          )}
          {routines.map((r) => (
            <RoutineListItem
              key={r.id}
              routine={r}
              active={r.id === selectedId}
              onClick={() => void select(r.id)}
            />
          ))}
        </div>
      </aside>

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        {selected
          ? <RoutineDetail routine={selected} />
          : (
            <div className="h-full flex items-center justify-center text-sm text-[var(--theme-text-faint)]">
              Select a routine
            </div>
          )}
      </main>

      {creating && (
        <RoutineEditor
          templates={templates}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function RoutineListItem({ routine, active, onClick }: {
  routine: RoutineListItemDto; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-2.5 border-b border-[var(--theme-border)] transition-colors',
        active ? 'bg-[var(--theme-bg-hover)]' : 'hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span>{routine.emoji || '🔁'}</span>
        <span className="text-sm truncate text-[var(--theme-text-primary)]">{routine.name}</span>
        {routine.awaitingAttention && (
          <span className="text-[10px] ml-auto px-1.5 py-0.5 rounded bg-[var(--theme-warning)] text-[var(--theme-bg-primary)]">
            waiting
          </span>
        )}
        {!routine.awaitingAttention && !routine.enabled && (
          <span className="text-[10px] text-[var(--theme-text-faint)] ml-auto">paused</span>
        )}
      </div>
      <div className="text-[11px] text-[var(--theme-text-faint)] mt-0.5">
        {routine.trigger.kind}
        {routine.lastRunAt && ` · last run ${new Date(routine.lastRunAt).toLocaleString(undefined, { hour12: false })}`}
      </div>
    </button>
  );
}
