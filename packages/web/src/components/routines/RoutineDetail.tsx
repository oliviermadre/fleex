import { useState } from 'react';
import type { Routine, RoutineTrigger, WorkflowRunStatus } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { WorkflowRunView } from '../workflows/WorkflowRunView';
import { RoutineEditor } from './RoutineEditor';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { cn } from '../../lib/cn';
import { tint, tintSolid, tintText, type TintHue } from '../../lib/tints';

const CARD_SHELL = 'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-5';

/** Relative age of a timestamp — "2h ago", "3d ago". */
export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.floor(diff / 60000)}m ago`;
}

/**
 * One-line description of how a routine starts. The raw `cron` kind alone is
 * useless in a header chip — what the reader wants is "every 15 min", and the
 * expression itself right behind it.
 */
export function describeTrigger(trigger: RoutineTrigger): string {
  if (trigger.kind === 'manual') return 'manual';
  if (trigger.kind === 'once') return 'once';
  return `cron · ${trigger.cron}`;
}

export function triggerTimezone(trigger: RoutineTrigger): string | undefined {
  return trigger.kind === 'manual' ? undefined : trigger.timezone;
}

/** An absolute timestamp, in the routine's own zone when it has one. */
export function formatAbsolute(dateStr: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...(timezone ? { timeZone: timezone } : {}),
      weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(dateStr));
  } catch {
    return new Date(dateStr).toLocaleString();
  }
}

const RUN_STATUS_HUE: Record<WorkflowRunStatus, TintHue> = {
  running: 'blue',
  blocked: 'orange',
  needs_review: 'yellow',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
};

function runStatusHue(status: string): TintHue {
  return RUN_STATUS_HUE[status as WorkflowRunStatus] ?? 'gray';
}

function CardHeader({ hue, label, action }: { hue: TintHue; label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
      <span className={cn('h-2 w-2 rounded-full', tintSolid(hue))} />
      {label}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

/**
 * Routine detail: subject + trigger summary, the Launch button, and the run
 * history. Each run mounts the existing `WorkflowRunView`, which is what makes
 * gates and needs_review resolvable from here without a second run screen.
 */
export function RoutineDetail({ routine }: { routine: Routine }) {
  const { runs, runsLoading, launch, remove, refreshRuns } = useRoutineStore();
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const onDelete = async () => {
    setDeleting(true);
    try {
      await remove(routine.id);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <section className={CARD_SHELL}>
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none">{routine.emoji || '🔁'}</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-[var(--theme-text-primary)]">{routine.name}</h1>
            {routine.description && (
              <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">{routine.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-muted)]">
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5', tint('purple'))}>
                {template ? `${template.emoji ?? ''} ${template.name}` : routine.templateId}
              </span>
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5', tint('blue'))}>
                {describeTrigger(routine.trigger)}
              </span>
              {routine.nextRunAt && routine.enabled && (
                <span className={cn('inline-flex items-center rounded px-1.5 py-0.5', tint('teal'))}>
                  next run {formatAbsolute(routine.nextRunAt, triggerTimezone(routine.trigger))}
                </span>
              )}
              {!routine.enabled && (
                <span className={cn('inline-flex items-center rounded px-1.5 py-0.5', tint('gray'))}>paused</span>
              )}
              <span className="font-mono">/{routine.slug}</span>
              {routine.lastRunAt && <span>last run {formatRelativeTime(routine.lastRunAt)}</span>}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button variant="primary" size="sm" disabled={launching} onClick={() => void onLaunch()}>
              {launching ? 'Launching…' : 'Launch'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>Delete</Button>
          </div>
        </div>

        {launchError && <p className={cn('mt-3 text-xs', tintText('red'))}>{launchError}</p>}
      </section>

      <section className={CARD_SHELL}>
        <CardHeader hue="teal" label="Subject" />
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <div className="text-xs text-[var(--theme-text-muted)]">Repositories</div>
            {routine.subject.repos.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {routine.subject.repos.map((repo) => (
                  <span
                    key={repo}
                    className="rounded bg-[var(--theme-accent-muted)] px-2 py-0.5 font-mono text-xs text-[var(--theme-accent)]"
                  >
                    {repo}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-[var(--theme-text-muted)]">No repository — the agent runs without a workspace.</p>
            )}
          </div>
          <div>
            <div className="text-xs text-[var(--theme-text-muted)]">Brief</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--theme-text-secondary)]">
              {routine.subject.brief || '—'}
            </p>
          </div>
        </div>
      </section>

      <section className={CARD_SHELL}>
        <CardHeader
          hue="indigo"
          label={`Runs${runs.length > 0 ? ` · ${runs.length}` : ''}`}
          action={
            <Button variant="ghost" size="sm" onClick={() => void refreshRuns()}>Refresh</Button>
          }
        />

        {runsLoading && <p className="mt-3 text-xs text-[var(--theme-text-muted)]">Loading runs…</p>}
        {!runsLoading && runs.length === 0 && (
          <p className="mt-3 text-sm text-[var(--theme-text-muted)]">No run yet. Hit Launch to start one.</p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {runs.map(({ run, stepRuns, deliverables }) => {
            const isOpen = openRunId === run.id;
            return (
              <div key={run.id} className="overflow-hidden rounded-lg border border-[var(--theme-border)]">
                <button
                  type="button"
                  onClick={() => setOpenRunId(isOpen ? null : run.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', tintSolid(runStatusHue(run.status)))} />
                  <span className={cn('text-xs font-medium', tintText(runStatusHue(run.status)))}>
                    {run.status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-[var(--theme-text-muted)]">
                    {formatRelativeTime(run.startedAt)}
                  </span>
                  {deliverables.length > 0 && (
                    <span className="text-xs text-[var(--theme-text-muted)]">
                      · {deliverables.length} deliverable{deliverables.length > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-[var(--theme-text-muted)]">{isOpen ? '▾' : '▸'}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--theme-border)]">
                    <div className="h-[420px]">
                      <WorkflowRunView run={run} stepRuns={stepRuns} />
                    </div>
                    {deliverables.length > 0 && (
                      <div className="flex flex-col gap-1 border-t border-[var(--theme-border)] px-3 py-2">
                        {deliverables.map((d) => (
                          // A routine run has no ticket, so the Docs view used
                          // to be the only place these were readable. They open
                          // in the same overlay as everywhere else.
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => openDeliverable(d)}
                            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                          >
                            <span className="text-[var(--theme-text-muted)]">{d.type}</span>
                            <span className="truncate text-[var(--theme-text-primary)] group-hover:underline">{d.title}</span>
                            <span className="ml-auto text-[var(--theme-text-muted)]">{d.status}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {editing && (
        <RoutineEditor routine={routine} templates={templates} onClose={() => setEditing(false)} />
      )}

      <ConfirmModal
        open={confirmingDelete}
        title="Delete routine"
        message={<>Delete <strong>{routine.name}</strong>? Its run history will no longer be reachable.</>}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
