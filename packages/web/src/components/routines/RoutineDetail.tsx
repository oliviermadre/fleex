import { useState } from 'react';
import type { Routine, RoutineTrigger, WorkflowRunStatus } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { WorkflowRunView } from '../workflows/WorkflowRunView';
import type { RoutineRunDetail } from '../../services/api';
import { cn } from '../../lib/cn';
import { tint, tintSolid, tintText, type TintHue } from '../../lib/tints';
import { PrimitiveIcon, RoutineIcon } from '../../lib/primitives';

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

/** A run the user may still have to act on (gate, review, or just watch). */
function isActiveStatus(status: string): boolean {
  return status === 'running' || status === 'blocked' || status === 'needs_review';
}

/**
 * Routine detail. Layout priority is the run, not the routine's metadata:
 *
 * - a slim header bar (same geometry as the agentic detail view) with the
 *   routine's identity chips and the Play button — edit/delete live on the
 *   sidebar rows, not here;
 * - the CURRENT run (active one, else the latest) mounted directly below,
 *   taking all remaining height — the DAG and its gate/review panels are
 *   visible with zero clicks instead of being buried three cards deep;
 * - past runs in a separate, collapsed History section with its own scroll.
 */
export function RoutineDetail({ routine }: { routine: Routine }) {
  const { runs, runsLoading, launch, refreshRuns } = useRoutineStore();
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const template = templates.find((t) => t.id === routine.templateId);

  // The run that deserves the screen: the one still moving, else the latest.
  const current = runs.find(({ run }) => isActiveStatus(run.status)) ?? runs[0] ?? null;
  const history = runs.filter(({ run }) => run.id !== current?.run.id);
  const isActive = current !== null && isActiveStatus(current.run.status);

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
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — matches the AgentPersonaView / SessionHeader bar. */}
      <div
        className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3"
        style={{ height: 'var(--header-height)' }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <RoutineIcon size={14} tinted={false} className="shrink-0 text-[var(--theme-text-secondary)]" />
          <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
            {routine.name}
          </span>
        </div>

        {/* The workflow this routine runs, with the canonical workflow glyph. */}
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs', tint('purple'))}>
          <PrimitiveIcon kind="workflow" size={12} tinted={false} className="shrink-0" />
          {template ? template.name : routine.templateId}
        </span>
        <span className={cn('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs', tint('blue'))}>
          {describeTrigger(routine.trigger)}
        </span>
        {routine.nextRunAt && routine.enabled && (
          <span className={cn('hidden shrink-0 items-center rounded px-1.5 py-0.5 text-xs lg:inline-flex', tint('teal'))}>
            next {formatAbsolute(routine.nextRunAt, triggerTimezone(routine.trigger))}
          </span>
        )}
        {!routine.enabled && (
          <span className={cn('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs', tint('gray'))}>paused</span>
        )}

        {isActive && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn('h-2 w-2 animate-pulse rounded-full', tintSolid(runStatusHue(current.run.status)))} />
            <span className={cn('text-[10px]', tintText(runStatusHue(current.run.status)))}>
              {current.run.status.replace('_', ' ')}
            </span>
          </div>
        )}

        <span className="hidden shrink-0 truncate font-mono text-xs text-[var(--theme-text-faint)] md:inline">
          /{routine.slug}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void onLaunch()}
            disabled={launching || isActive}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors',
              launching || isActive
                ? 'cursor-not-allowed text-[var(--theme-text-faint)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
            )}
            title={isActive ? 'A run is already active' : 'Launch this routine now'}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
            {launching ? 'Launching…' : 'Play'}
          </button>
        </div>
      </div>

      {launchError && (
        <p className={cn('border-b border-[var(--theme-border)] px-4 py-2 text-xs', tintText('red'))}>{launchError}</p>
      )}

      {/* Subject strip — one compact line, not a card stack eating run space. */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-4 py-2 text-xs">
        {routine.description && (
          <span className="shrink-0 text-[var(--theme-text-secondary)]">{routine.description}</span>
        )}
        {routine.subject.repos.length > 0 ? (
          <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            {routine.subject.repos.map((repo) => (
              <span key={repo} className="rounded bg-[var(--theme-accent-muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-accent)]">
                {repo}
              </span>
            ))}
          </span>
        ) : (
          <span className="shrink-0 text-[var(--theme-text-muted)]">no repo — the agent runs without a workspace</span>
        )}
        {routine.subject.brief && (
          <span className="min-w-0 flex-1 truncate text-[var(--theme-text-muted)]" title={routine.subject.brief}>
            {routine.subject.brief}
          </span>
        )}
      </div>

      {/* Current run — the main real estate, zero clicks to reach it. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {runsLoading && runs.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-xs text-[var(--theme-text-muted)]">
            Loading runs…
          </div>
        )}
        {!runsLoading && current === null && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--theme-text-muted)]">
            <RoutineIcon size={32} strokeWidth={1} tinted={false} className="text-[var(--theme-text-faint)]" />
            <p className="text-sm">No run yet. Hit Play to start one.</p>
          </div>
        )}
        {current && (
          <>
            <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-4 py-1.5 text-xs">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', tintSolid(runStatusHue(current.run.status)))} />
              <span className={cn('font-medium', tintText(runStatusHue(current.run.status)))}>
                {current.run.status.replace('_', ' ')}
              </span>
              <span className="text-[var(--theme-text-muted)]">
                {isActive ? 'current run' : 'latest run'} · started {formatRelativeTime(current.run.startedAt)}
              </span>
              <RunDeliverables deliverables={current.deliverables} />
              <button
                onClick={() => void refreshRuns()}
                title="Refresh runs"
                className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <WorkflowRunView run={current.run} stepRuns={current.stepRuns} />
            </div>
          </>
        )}
      </div>

      {/* History — separated from the current run, its own scroll, collapsed
          by default so it never steals space from the run in progress. */}
      {history.length > 0 && (
        <div className="shrink-0 border-t border-[var(--theme-border)]">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
          >
            <svg
              width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className={cn('shrink-0 text-[var(--theme-text-muted)] transition-transform', historyOpen && 'rotate-90')}
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">History</span>
            <span className="text-[10px] font-medium text-[var(--theme-text-faint)]">{history.length}</span>
          </button>
          {historyOpen && (
            <div className="max-h-[40vh] overflow-y-auto border-t border-[var(--theme-border)]">
              {history.map((detail) => (
                <HistoryRun key={detail.run.id} detail={detail} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Deliverable chips for a run — open in the shared reading overlay. */
function RunDeliverables({ deliverables }: { deliverables: RoutineRunDetail['deliverables'] }) {
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  if (deliverables.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {deliverables.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => openDeliverable(d)}
          title={d.title}
          className="flex min-w-0 items-center gap-1 rounded border border-[var(--theme-border)] px-1.5 py-0.5 text-[11px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
        >
          <span className="shrink-0 text-[var(--theme-text-muted)]">{d.type}</span>
          <span className="truncate">{d.title}</span>
        </button>
      ))}
    </span>
  );
}

/** One past run: a compact row, expandable to its full DAG when needed. */
function HistoryRun({ detail }: { detail: RoutineRunDetail }) {
  const { run, stepRuns, deliverables } = detail;
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--theme-border)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', tintSolid(runStatusHue(run.status)))} />
        <span className={cn('text-xs font-medium', tintText(runStatusHue(run.status)))}>
          {run.status.replace('_', ' ')}
        </span>
        <span className="text-xs text-[var(--theme-text-muted)]">{formatRelativeTime(run.startedAt)}</span>
        {deliverables.length > 0 && (
          <span className="text-xs text-[var(--theme-text-muted)]">
            · {deliverables.length} deliverable{deliverables.length > 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--theme-text-muted)]">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--theme-border)]">
          <div className="h-[360px]">
            <WorkflowRunView run={run} stepRuns={stepRuns} />
          </div>
          {deliverables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--theme-border)] px-4 py-2">
              <RunDeliverables deliverables={deliverables} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
