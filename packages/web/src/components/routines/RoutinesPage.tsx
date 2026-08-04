import { useEffect, useState } from 'react';
import { useRoutineStore } from '../../stores/routineStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { RoutineDetail, formatRelativeTime, describeTrigger } from './RoutineDetail';
import { RoutineEditor } from './RoutineEditor';
import type { RoutineListItem as RoutineListItemDto } from '../../services/api';
import { Button } from '../ui/Button';
import { DeliverableReadingOverlay } from '../tickets/DeliverableReadingOverlay';
import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';
import { RoutineIcon } from '../../lib/primitives';

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

  // Live updates (scheduler firing, steps completing, gates opening) are wired
  // once in the nav sidebar via `useRoutineLiveUpdates` — it is always mounted,
  // so the badge stays honest even when this screen is closed.

  const selected = routines.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-[var(--theme-border)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--theme-border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--theme-text-primary)]">Routines</div>
            <div className="text-xs text-[var(--theme-text-muted)]">
              {routines.length} routine{routines.length === 1 ? '' : 's'}
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>New routine</Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-4 py-3 text-xs text-[var(--theme-text-muted)]">Loading…</p>}
          {error && <p className={cn('px-4 py-3 text-xs', tintText('red'))}>{error}</p>}
          {!loading && !error && routines.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <RoutineIcon size={24} />
              <p className="text-xs text-[var(--theme-text-muted)]">
                No routine yet. A routine runs a workflow on a repo, a brief, or nothing at all — no ticket needed.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>Create one</Button>
            </div>
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

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {selected ? <RoutineDetail routine={selected} /> : <SelectRoutineEmptyState />}
      </main>

      {creating && (
        <RoutineEditor
          templates={templates}
          onClose={() => setCreating(false)}
        />
      )}

      {/* A routine run's deliverables open here, in place. Same overlay as the
          ticket and Docs views — a document produced by a routine must be
          readable where it was produced, not only from the Docs list. */}
      <DeliverableReadingOverlay />
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

function RoutineListItem({ routine, active, onClick }: {
  routine: RoutineListItemDto; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full min-w-0 items-center gap-2 border-l-2 py-2.5 pl-4 pr-3 text-left transition-colors',
        active
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      <RoutineIcon size={16} className="flex-shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{routine.name}</span>
        <span className="truncate text-[11px] text-[var(--theme-text-muted)]">
          {describeTrigger(routine.trigger)}
          {routine.lastRunAt && ` · last run ${formatRelativeTime(routine.lastRunAt)}`}
        </span>
      </div>
      {routine.awaitingAttention && (
        <span className={cn('flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', tint('yellow'))}>
          waiting
        </span>
      )}
      {!routine.awaitingAttention && !routine.enabled && (
        <span className="flex-shrink-0 text-[10px] text-[var(--theme-text-faint)]">paused</span>
      )}
    </button>
  );
}
