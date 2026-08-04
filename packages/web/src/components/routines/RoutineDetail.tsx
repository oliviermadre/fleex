import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Routine, RoutineTrigger, WorkflowRunStatus, WorkflowTemplate } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { WorkflowRunView } from '../workflows/WorkflowRunView';
import { RoutineEditor } from './RoutineEditor';
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

/** "4m 12s" / "1h 03m" — for run durations on the dashboard. */
function formatDuration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
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

type Tab = 'overview' | 'current' | 'history' | 'config';

/**
 * Routine detail — the same tab anatomy as the Repository dashboard and the
 * Agentic Catalog:
 *
 * - a slim identity header (name, workflow chip, status, Play);
 * - a tab bar: Overview (the routine's home — stats, config summary and
 *   redirect tables), Current Run (the active — else latest — run's DAG at
 *   full height), History (the archive), Config (the full recipe, editable);
 * - edit/delete still live on the sidebar rows; Play is the only header action.
 *
 * Tab state is local, like `RepositoryDashboard` — routines have no
 * per-routine URL, so there is nothing to sync a route segment with.
 */
export function RoutineDetail({ routine }: { routine: Routine }) {
  const { runs, runsLoading, launch, refreshRuns } = useRoutineStore();
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Each routine gets its own landing: switching routine resets to Overview.
  useEffect(() => {
    setActiveTab('overview');
  }, [routine.id]);

  const template = templates.find((t) => t.id === routine.templateId);

  // The run that deserves the "Current Run" tab: still moving, else the latest.
  const current = runs.find(({ run }) => isActiveStatus(run.status)) ?? runs[0] ?? null;
  const history = runs.filter(({ run }) => run.id !== current?.run.id);
  const isActive = current !== null && isActiveStatus(current.run.status);

  const onLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      await launch(routine.id);
      setActiveTab('current');
    } catch (err) {
      // A 409 here means a run is already active — surfaced rather than swallowed,
      // otherwise the button looks broken.
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'current', label: 'Current Run' },
    { key: 'history', label: 'History', count: history.length },
    { key: 'config', label: 'Config' },
  ];

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

      {/* Tab bar — same markup as RepositoryDashboard / AgentPersonaView. */}
      <div className="flex items-center gap-0 overflow-x-auto border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs transition-colors',
              activeTab === tab.key
                ? 'text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.key === 'current' && isActive && (
              <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full', tintSolid(runStatusHue(current.run.status)))} />
            )}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  activeTab === tab.key
                    ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
                    : 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-muted)]',
                )}
              >
                {tab.count}
              </span>
            )}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
            )}
          </button>
        ))}
      </div>

      {/* The Current Run tab owns the full remaining height (the DAG needs a
          sized parent); every other tab is a padded scroll area. */}
      {activeTab === 'current' ? (
        <CurrentRunTab
          current={current}
          isActive={isActive}
          loading={runsLoading && runs.length === 0}
          onRefresh={() => void refreshRuns()}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <OverviewTab routine={routine} template={template} runs={runs} onNavigate={setActiveTab} />
          )}
          {activeTab === 'history' && <HistoryTab history={history} />}
          {activeTab === 'config' && <ConfigTab routine={routine} template={template} />}
        </div>
      )}
    </div>
  );
}

const CARD_SHELL = 'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-5';

function CardHeader({ hue, label }: { hue: TintHue; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
      <span className={cn('h-2 w-2 rounded-full', tintSolid(hue))} />
      {label}
    </div>
  );
}

/**
 * The routine's home — same anatomy as the Repository Overview: a row of stat
 * cards, then redirect tables toward the tabs that hold the full story.
 */
function OverviewTab({ routine, template, runs, onNavigate }: {
  routine: Routine;
  template: WorkflowTemplate | undefined;
  runs: RoutineRunDetail[];
  onNavigate: (tab: Tab) => void;
}) {
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);

  const completed = runs.filter(({ run }) => run.status === 'completed');
  const failed = runs.filter(({ run }) => run.status === 'failed');
  const activeRun = runs.find(({ run }) => isActiveStatus(run.status)) ?? null;
  const deliverables = useMemo(
    () => runs.flatMap((r) => r.deliverables),
    [runs],
  );
  const durations = completed
    .filter(({ run }) => run.completedAt)
    .map(({ run }) => new Date(run.completedAt as string).getTime() - new Date(run.startedAt).getTime());
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;

  const recentRuns = runs.slice(0, 5);
  const recentDeliverables = deliverables.slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-4">
        {/* Executions */}
        <div className={CARD_SHELL}>
          <CardHeader hue="purple" label="Executions" />
          <div className="mt-1 text-[28px] font-bold leading-tight text-[var(--theme-text-primary)]">
            {runs.length}
          </div>
          <div className="text-[11px] text-[var(--theme-text-muted)]">
            {completed.length} completed · {failed.length} failed
            {activeRun && <span className={cn('ml-2', tintText(runStatusHue(activeRun.run.status)))}>1 active</span>}
          </div>
        </div>

        {/* Avg duration */}
        <div className={CARD_SHELL}>
          <CardHeader hue="blue" label="Avg duration" />
          <div className="mt-1 text-[28px] font-bold leading-tight text-[var(--theme-text-primary)]">
            {avgDuration !== null ? formatDuration(avgDuration) : '—'}
          </div>
          <div className="text-[11px] text-[var(--theme-text-muted)]">
            {durations.length > 0 ? `over ${durations.length} completed run${durations.length > 1 ? 's' : ''}` : 'no completed run yet'}
          </div>
        </div>

        {/* Deliverables */}
        <div className={CARD_SHELL}>
          <CardHeader hue="green" label="Deliverables" />
          <div className="mt-1 text-[28px] font-bold leading-tight text-[var(--theme-text-primary)]">
            {deliverables.length}
          </div>
          <div className="truncate text-[11px] text-[var(--theme-text-muted)]">
            {deliverables[0] ? `latest: ${deliverables[0].title}` : 'none produced yet'}
          </div>
        </div>

        {/* Schedule */}
        <div className={CARD_SHELL}>
          <CardHeader hue="teal" label="Schedule" />
          <div className="mt-1 truncate text-lg font-bold leading-[38px] text-[var(--theme-text-primary)]">
            {routine.enabled ? describeTrigger(routine.trigger) : 'paused'}
          </div>
          <div className="truncate text-[11px] text-[var(--theme-text-muted)]">
            {routine.nextRunAt && routine.enabled
              ? `next ${formatAbsolute(routine.nextRunAt, triggerTimezone(routine.trigger))}`
              : routine.lastRunAt
                ? `last run ${formatRelativeTime(routine.lastRunAt)}`
                : 'never ran'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Recent runs → Current Run / History */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Recent runs</span>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs text-[var(--theme-accent)] hover:underline"
            >
              {runs.length} →
            </button>
          </div>
          {recentRuns.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--theme-text-muted)]">No run yet. Hit Play to start one.</div>
          ) : (
            recentRuns.map(({ run, deliverables: runDeliverables }) => (
              <div
                key={run.id}
                className="flex cursor-pointer items-center gap-3 border-b border-[var(--theme-border-subtle)] px-5 py-3 last:border-0 hover:bg-[var(--theme-bg-hover)]"
                onClick={() => onNavigate(isActiveStatus(run.status) || runs[0]?.run.id === run.id ? 'current' : 'history')}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', tintSolid(runStatusHue(run.status)), isActiveStatus(run.status) && 'animate-pulse')} />
                <span className={cn('shrink-0 text-xs font-medium', tintText(runStatusHue(run.status)))}>
                  {run.status.replace('_', ' ')}
                </span>
                <span className="text-xs text-[var(--theme-text-muted)]">{formatRelativeTime(run.startedAt)}</span>
                {run.completedAt && (
                  <span className="text-xs text-[var(--theme-text-muted)]">
                    · {formatDuration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())}
                  </span>
                )}
                {runDeliverables.length > 0 && (
                  <span className="ml-auto text-xs text-[var(--theme-text-muted)]">
                    {runDeliverables.length} deliverable{runDeliverables.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Config summary → Config */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Configuration</span>
            <button
              type="button"
              onClick={() => onNavigate('config')}
              className="text-xs text-[var(--theme-accent)] hover:underline"
            >
              details →
            </button>
          </div>
          <div className="flex flex-col gap-2.5 px-5 py-4 text-xs">
            <ConfigRow label="Workflow">
              <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5', tint('purple'))}>
                <PrimitiveIcon kind="workflow" size={12} tinted={false} className="shrink-0" />
                {template ? template.name : routine.templateId}
              </span>
            </ConfigRow>
            <ConfigRow label="Trigger">
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5', tint('blue'))}>{describeTrigger(routine.trigger)}</span>
            </ConfigRow>
            <ConfigRow label="Repositories">
              {routine.subject.repos.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  {routine.subject.repos.map((repo) => (
                    <span key={repo} className="rounded bg-[var(--theme-accent-muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-accent)]">
                      {repo}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-[var(--theme-text-muted)]">none — the agent runs without a workspace</span>
              )}
            </ConfigRow>
            <ConfigRow label="Brief">
              {routine.subject.brief ? (
                <span className="line-clamp-2 text-[var(--theme-text-secondary)]" title={routine.subject.brief}>
                  {routine.subject.brief}
                </span>
              ) : (
                <span className="text-[var(--theme-text-muted)]">none</span>
              )}
            </ConfigRow>
            <ConfigRow label="Status">
              <span className={routine.enabled ? tintText('green') : 'text-[var(--theme-text-muted)]'}>
                {routine.enabled ? 'enabled' : 'paused'}
              </span>
            </ConfigRow>
          </div>
        </div>
      </div>

      {/* Recent deliverables — direct to the reading overlay. */}
      {recentDeliverables.length > 0 && (
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Recent deliverables</span>
            <span className="text-xs text-[var(--theme-text-muted)]">{deliverables.length}</span>
          </div>
          {recentDeliverables.map((d) => (
            <div
              key={d.id}
              className="flex cursor-pointer items-center gap-2 border-b border-[var(--theme-border-subtle)] px-5 py-3 last:border-0 hover:bg-[var(--theme-bg-hover)]"
              onClick={() => openDeliverable(d)}
            >
              <span className="shrink-0 rounded border border-[var(--theme-border)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]">{d.type}</span>
              <span className="truncate text-[13.5px] font-semibold text-[var(--theme-text-primary)]">{d.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 pt-0.5 text-[var(--theme-text-muted)]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The active (else latest) run's DAG, at full height — zero chrome around it. */
function CurrentRunTab({ current, isActive, loading, onRefresh }: {
  current: RoutineRunDetail | null;
  isActive: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading && (
        <div className="flex flex-1 items-center justify-center text-xs text-[var(--theme-text-muted)]">
          Loading runs…
        </div>
      )}
      {!loading && current === null && (
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
              onClick={onRefresh}
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
  );
}

/** The archive — every past run, expandable to its full DAG. */
function HistoryTab({ history }: { history: RoutineRunDetail[] }) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-[var(--theme-text-muted)]">
        <RoutineIcon size={32} strokeWidth={1} tinted={false} className="text-[var(--theme-text-faint)]" />
        <p className="text-sm">No past run yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {history.map((detail) => (
        <HistoryRun key={detail.run.id} detail={detail} />
      ))}
    </div>
  );
}

/** The full recipe, read-only — editing opens the shared RoutineEditor modal. */
function ConfigTab({ routine, template }: { routine: Routine; template: WorkflowTemplate | undefined }) {
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const [editing, setEditing] = useState(false);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Configuration</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--theme-accent)] hover:underline"
          >
            Edit
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4 text-xs">
          <ConfigRow label="Name">
            <span className="font-semibold text-[var(--theme-text-primary)]">{routine.name}</span>
            <span className="ml-2 font-mono text-[var(--theme-text-faint)]">/{routine.slug}</span>
          </ConfigRow>
          <ConfigRow label="Description">
            <span className="text-[var(--theme-text-secondary)]">{routine.description || <span className="text-[var(--theme-text-muted)]">none</span>}</span>
          </ConfigRow>
          <ConfigRow label="Workflow">
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5', tint('purple'))}>
              <PrimitiveIcon kind="workflow" size={12} tinted={false} className="shrink-0" />
              {template ? template.name : routine.templateId}
            </span>
          </ConfigRow>
          <ConfigRow label="Trigger">
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5', tint('blue'))}>{describeTrigger(routine.trigger)}</span>
            {triggerTimezone(routine.trigger) && (
              <span className="ml-2 text-[var(--theme-text-muted)]">{triggerTimezone(routine.trigger)}</span>
            )}
          </ConfigRow>
          {routine.nextRunAt && routine.enabled && (
            <ConfigRow label="Next run">
              <span className="text-[var(--theme-text-secondary)]">{formatAbsolute(routine.nextRunAt, triggerTimezone(routine.trigger))}</span>
            </ConfigRow>
          )}
          <ConfigRow label="Repositories">
            {routine.subject.repos.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {routine.subject.repos.map((repo) => (
                  <span key={repo} className="rounded bg-[var(--theme-accent-muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-accent)]">
                    {repo}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-[var(--theme-text-muted)]">none — the agent runs without a workspace</span>
            )}
          </ConfigRow>
          <ConfigRow label="Brief">
            {routine.subject.brief ? (
              <p className="whitespace-pre-wrap text-[var(--theme-text-secondary)]">{routine.subject.brief}</p>
            ) : (
              <span className="text-[var(--theme-text-muted)]">none</span>
            )}
          </ConfigRow>
          <ConfigRow label="Overlap">
            <span className="text-[var(--theme-text-secondary)]">{routine.overlapPolicy}</span>
            <span className="ml-2 text-[var(--theme-text-muted)]">
              {routine.overlapPolicy === 'skip' ? '— a tick fired mid-run is dropped' : '— a tick fired mid-run waits its turn'}
            </span>
          </ConfigRow>
          <ConfigRow label="Status">
            <span className={routine.enabled ? tintText('green') : 'text-[var(--theme-text-muted)]'}>
              {routine.enabled ? 'enabled' : 'paused'}
            </span>
          </ConfigRow>
          <ConfigRow label="Created">
            <span className="text-[var(--theme-text-muted)]">{formatAbsolute(routine.createdAt)}</span>
          </ConfigRow>
        </div>
      </div>

      {editing && (
        <RoutineEditor routine={routine} templates={templates} onClose={() => setEditing(false)} />
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
        {run.completedAt && (
          <span className="text-xs text-[var(--theme-text-muted)]">
            · {formatDuration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())}
          </span>
        )}
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
