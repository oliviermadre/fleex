import { useState } from 'react';
import type { Routine } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { WorkflowRunView } from '../workflows/WorkflowRunView';
import { RoutineEditor } from './RoutineEditor';

/**
 * Routine detail: subject + trigger summary, the Launch button, and the run
 * history. Each run mounts the existing `WorkflowRunView`, which is what makes
 * gates and needs_review resolvable from here without a second run screen.
 */
export function RoutineDetail({ routine }: { routine: Routine }) {
  const { runs, runsLoading, launch, remove, refreshRuns } = useRoutineStore();
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const [editing, setEditing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const template = templates.find((t) => t.id === routine.templateId);

  const onLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      await launch(routine.id);
    } catch (err) {
      // A 409 here means a run is already active — surfaced rather than swallowed,
      // otherwise the button looks broken.
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <span className="text-2xl">{routine.emoji || '🔁'}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-[var(--theme-text-primary)]">{routine.name}</h1>
          {routine.description && (
            <p className="text-sm text-[var(--theme-text-secondary)] mt-1">{routine.description}</p>
          )}
          <p className="text-xs text-[var(--theme-text-faint)] mt-1">
            {template ? `${template.emoji ?? ''} ${template.name}` : routine.templateId}
            {' · '}trigger: {routine.trigger.kind}
            {' · '}/{routine.slug}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onLaunch()}
            disabled={launching}
            className="text-sm px-3 py-1.5 rounded bg-[var(--theme-accent)] text-[var(--theme-accent-contrast)] disabled:opacity-50"
          >
            {launching ? 'Launching…' : 'Lancer'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm px-3 py-1.5 rounded border border-[var(--theme-border)] text-[var(--theme-text-secondary)]"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => { if (confirm(`Delete routine "${routine.name}"?`)) void remove(routine.id); }}
            className="text-sm px-3 py-1.5 rounded border border-[var(--theme-border)] text-[var(--theme-danger)]"
          >
            Delete
          </button>
        </div>
      </header>

      {launchError && <p className="text-sm text-[var(--theme-danger)]">{launchError}</p>}

      <section>
        <h2 className="text-sm font-semibold text-[var(--theme-text-primary)] mb-2">Subject</h2>
        <div className="text-sm text-[var(--theme-text-secondary)] flex flex-col gap-1">
          <div>
            <span className="text-[var(--theme-text-faint)]">Repos: </span>
            {routine.subject.repos.length > 0 ? routine.subject.repos.join(', ') : '—'}
          </div>
          <div className="whitespace-pre-wrap">
            <span className="text-[var(--theme-text-faint)]">Brief: </span>
            {routine.subject.brief || '—'}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Runs</h2>
          <button
            type="button"
            onClick={() => void refreshRuns()}
            className="text-xs text-[var(--theme-text-faint)] hover:text-[var(--theme-text-primary)]"
          >
            Refresh
          </button>
        </div>

        {runsLoading && <p className="text-xs text-[var(--theme-text-faint)]">Loading runs…</p>}
        {!runsLoading && runs.length === 0 && (
          <p className="text-xs text-[var(--theme-text-faint)]">No run yet.</p>
        )}

        <div className="flex flex-col gap-2">
          {runs.map(({ run, stepRuns, deliverables }) => (
            <div key={run.id} className="border border-[var(--theme-border)] rounded">
              <button
                type="button"
                onClick={() => setOpenRunId(openRunId === run.id ? null : run.id)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left"
              >
                <span className="text-xs text-[var(--theme-text-secondary)]">{run.status}</span>
                <span className="text-xs text-[var(--theme-text-faint)]">
                  {new Date(run.startedAt).toLocaleString(undefined, { hour12: false })}
                </span>
                {deliverables.length > 0 && (
                  <span className="text-xs text-[var(--theme-text-faint)]">
                    · {deliverables.length} deliverable{deliverables.length > 1 ? 's' : ''}
                  </span>
                )}
                <span className="ml-auto text-[var(--theme-text-faint)]">{openRunId === run.id ? '▾' : '▸'}</span>
              </button>

              {openRunId === run.id && (
                <div className="border-t border-[var(--theme-border)]">
                  <div className="h-[420px]">
                    <WorkflowRunView run={run} stepRuns={stepRuns} />
                  </div>
                  {deliverables.length > 0 && (
                    <div className="px-3 py-2 border-t border-[var(--theme-border)]">
                      {deliverables.map((d) => (
                        <div key={d.id} className="text-xs text-[var(--theme-text-secondary)]">
                          [{d.status}] {d.title} ({d.type})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <RoutineEditor routine={routine} templates={templates} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
