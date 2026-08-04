import { useEffect, useState } from 'react';
import { useRoutineStore } from '../../stores/routineStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { RoutineDetail, formatRelativeTime, describeTrigger } from './RoutineDetail';
import { RoutineEditor } from './RoutineEditor';
import type { RoutineListItem as RoutineListItemDto } from '../../services/api';
import { Button } from '../ui/Button';
import { appWs } from '../../services/websocket';
import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';

/**
 * The Routines screen — the single home for every workflow execution that has
 * no ticket. Deliberately a master/detail page rather than a new "run" view:
 * the PRD's binding decision is one new concept, one new screen, and the run
 * itself is rendered by the existing WorkflowRunView inside the detail.
 */
export function RoutinesPage() {
  const { routines, loading, error, selectedId, load, select, refreshRuns } = useRoutineStore();
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const refreshTemplates = useWorkflowTemplateStore((s) => s.refresh);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void load();
    if (templates.length === 0) void refreshTemplates();
    // Mount-only: the stores own their own invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A scheduled routine fires with nobody watching. Without this the screen
  // would show a stale "last run 3d ago" until the user thought to reload —
  // which is exactly the moment they stop trusting the scheduler.
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      const type = (raw as { type?: string }).type;
      if (type === 'routine:run_started' || type === 'routine:run_completed' || type === 'routine:run_skipped') {
        void load();
        void refreshRuns();
      }
    });
    return unsub;
  }, [load, refreshRuns]);

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
              <span className="text-2xl">🔁</span>
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
    </div>
  );
}

function SelectRoutineEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--theme-text-muted)]">
      <svg width="48" height="48" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" className="text-[var(--theme-text-faint)]">
        <path d="M2.5 8a5.5 5.5 0 019.4-3.9M13.5 8a5.5 5.5 0 01-9.4 3.9" />
        <polyline points="11.5,1.5 12,4.2 9.3,4.6" />
        <polyline points="4.5,14.5 4,11.8 6.7,11.4" />
      </svg>
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
      <span className="flex-shrink-0 text-base leading-none">{routine.emoji || '🔁'}</span>
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
