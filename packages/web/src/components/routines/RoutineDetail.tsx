import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Routine, RoutineTarget, RoutineTrigger, WorkflowRunStatus, WorkflowTemplate } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { WorkflowRunView } from '../workflows/WorkflowRunView';
import { RoutineEditor } from './RoutineEditor';
import type { RoutineRunDetail } from '../../services/api';
import { cn } from '../../lib/cn';
import { tint, tintSolid, tintText, type TintHue } from '../../lib/tints';
import { PrimitiveIcon, RoutineIcon, type PrimitiveKind } from '../../lib/primitives';
import { clampPanelWidth, DEFAULT_PANEL_RATIO } from './runPanelWidth';

/** How each routine target kind maps onto the app's primitive iconography. */
const TARGET_PRIMITIVE_KIND: Record<RoutineTarget['kind'], PrimitiveKind> = {
  workflow: 'workflow',
  agent: 'persona',
  skill: 'skill',
  panel: 'panel',
};

const TARGET_KIND_LABEL: Record<RoutineTarget['kind'], string> = {
  workflow: 'Workflow',
  agent: 'Agent',
  skill: 'Skill',
  panel: 'Panel',
};

interface TargetInfo {
  kind: RoutineTarget['kind'];
  icon: PrimitiveKind;
  kindLabel: string;
  label: string;
}

/**
 * Display identity of a routine's target. Workflow refs are template ids and
 * resolve to the template's name; primitive refs (persona name, skill command
 * name, panel name) are already human-readable handles.
 */
export function describeTarget(target: RoutineTarget, templates: WorkflowTemplate[]): TargetInfo {
  const label = target.kind === 'workflow'
    ? templates.find((t) => t.id === target.ref)?.name ?? target.ref
    : target.ref;
  return { kind: target.kind, icon: TARGET_PRIMITIVE_KIND[target.kind], kindLabel: TARGET_KIND_LABEL[target.kind], label };
}

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

/** Open/close travel of the run panel — fast enough to feel instant, long enough to read as a slide. */
const PANEL_SLIDE_MS = 180;

/**
 * Routine detail — the same tab anatomy as the Repository dashboard and the
 * Agentic Catalog:
 *
 * - a slim identity header (name, workflow chip, status, Play);
 * - a tab bar: Overview (the routine's home — stats, config summary and
 *   redirect tables), Latest Run (the active — else latest — run's DAG at
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

  const targetInfo = describeTarget(routine.target, templates);

  // The run that deserves the "Latest Run" tab: still moving, else the latest.
  const current = runs.find(({ run }) => isActiveStatus(run.status)) ?? runs[0] ?? null;
  // History is the whole archive, including the run shown in "Latest Run" —
  // pinned first, so the tab is a complete ledger rather than "everything but
  // the one you were just looking at".
  const history = current ? [current, ...runs.filter(({ run }) => run.id !== current.run.id)] : runs;
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
    { key: 'current', label: 'Latest Run' },
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

        {/* The primitive this routine runs, with its canonical glyph. */}
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs', tint('purple'))}>
          <PrimitiveIcon kind={targetInfo.icon} size={12} tinted={false} className="shrink-0" />
          {targetInfo.label}
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

        {/* The canonical Fleex reference — same `@type:slug` handle as
            persona/skill/panel/workflow, highlighted like a mention chip. */}
        <span className={cn('hidden shrink-0 truncate rounded px-1.5 py-0.5 font-mono text-xs md:inline', tint('purple'))}>
          @routine:{routine.slug}
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

      {/* Latest Run and History own the full remaining height (both host a DAG,
          which needs a sized parent, and History anchors its slide-over to that
          box); Overview and Config are padded scroll areas. */}
      {activeTab === 'current' ? (
        <CurrentRunTab
          current={current}
          isActive={isActive}
          loading={runsLoading && runs.length === 0}
          onRefresh={() => void refreshRuns()}
        />
      ) : activeTab === 'history' ? (
        <HistoryTab history={history} />
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <OverviewTab routine={routine} targetInfo={targetInfo} runs={runs} onNavigate={setActiveTab} />
          )}
          {activeTab === 'config' && <ConfigTab routine={routine} targetInfo={targetInfo} />}
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
function OverviewTab({ routine, targetInfo, runs, onNavigate }: {
  routine: Routine;
  targetInfo: TargetInfo;
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
        {/* Recent runs → Latest Run / History */}
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
            <ConfigRow label={targetInfo.kindLabel}>
              <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5', tint('purple'))}>
                <PrimitiveIcon kind={targetInfo.icon} size={12} tinted={false} className="shrink-0" />
                {targetInfo.label}
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
              <span className="ml-auto shrink-0 text-xs text-[var(--theme-text-muted)]">{formatRelativeTime(d.createdAt)}</span>
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
            {current.deliverables.length > 0 && (
              <span className="text-[var(--theme-text-muted)]">
                · {current.deliverables.length} deliverable{current.deliverables.length > 1 ? 's' : ''} — on the producing steps below
              </span>
            )}
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
            <WorkflowRunView run={current.run} stepRuns={current.stepRuns} deliverables={current.deliverables} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The archive — every past run as a row, opened in a slide-over.
 *
 * The DAG used to unfold inside the row itself, in a card too short to read it.
 * Clicking now opens a panel over the listing (the Datadog log pattern): the
 * list stays put behind it, so moving from one run to the next costs one click,
 * and the run gets the full height of the pane instead of a fixed 360px.
 */
function HistoryTab({ history }: { history: RoutineRunDetail[] }) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  // Derived, not mirrored: a refresh that drops the open run closes the panel
  // rather than pinning it to a stale copy.
  const selected = history.find((d) => d.run.id === selectedRunId) ?? null;

  // The panel outlives its selection by the length of the slide-out, otherwise
  // unmounting on click would cut the closing animation on its first frame.
  const [lingering, setLingering] = useState<RoutineRunDetail | null>(null);
  useEffect(() => {
    if (selected) {
      setLingering(selected);
      return;
    }
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(null), PANEL_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [selected, lingering]);
  const panelDetail = selected ?? lingering;

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const area = areaRef.current;
    if (!area) return;
    const onMove = (ev: MouseEvent) => {
      const rect = area.getBoundingClientRect();
      setPanelWidth(clampPanelWidth(rect.right - ev.clientX, rect.width));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  if (history.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center gap-3 p-6 py-16 text-[var(--theme-text-muted)]">
        <RoutineIcon size={32} strokeWidth={1} tinted={false} className="text-[var(--theme-text-faint)]" />
        <p className="text-sm">No run yet.</p>
      </div>
    );
  }

  return (
    <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="h-full overflow-y-auto p-6">
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
          {history.map((detail) => (
            <HistoryRun
              key={detail.run.id}
              detail={detail}
              selected={detail.run.id === selectedRunId}
              onSelect={() => setSelectedRunId(detail.run.id)}
            />
          ))}
        </div>
      </div>

      {panelDetail && (
        <RunSlideOver
          detail={panelDetail}
          open={selected !== null}
          width={panelWidth}
          onStartResize={startResize}
          onClose={() => setSelectedRunId(null)}
        />
      )}
    </div>
  );
}

/**
 * The run panel: an overlay anchored to the right of the listing, resizable by
 * its left edge. Deliberately not a portal — it must cover the History pane and
 * nothing else, which the pane's own coordinates give for free.
 */
function RunSlideOver({
  detail,
  open,
  width,
  onStartResize,
  onClose,
}: {
  detail: RoutineRunDetail;
  /** false while sliding back out — the panel is still mounted, on its way off. */
  open: boolean;
  /** null until the handle is dragged: the panel opens at its default ratio. */
  width: number | null;
  onStartResize: (e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  const { run, stepRuns, deliverables } = detail;

  // Mount off-screen, then slide in on the next frame — the browser needs one
  // painted frame at the starting transform for the transition to run at all.
  const [slidIn, setSlidIn] = useState(false);
  useEffect(() => {
    if (!open) {
      setSlidIn(false);
      return;
    }
    const frame = requestAnimationFrame(() => setSlidIn(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Yield to any modal stacked above (deliverable reader, SDK session),
      // same guard as StepSessionOverlay — ESC must close one thing at a time.
      if (e.key !== 'Escape' || document.querySelector('[data-overlay-top]')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <>
      {/* The listing stays visible behind — that is the point of the pattern. */}
      <div
        className="absolute inset-0 z-10"
        style={{
          background: 'var(--theme-glass-overlay)',
          opacity: slidIn ? 1 : 0,
          transition: `opacity ${PANEL_SLIDE_MS}ms ease-out`,
        }}
        onMouseDown={onClose}
      />
      <div
        className="absolute inset-y-0 right-0 z-20 flex border-l border-[var(--theme-border)] shadow-2xl"
        style={{
          width: width ?? `${DEFAULT_PANEL_RATIO * 100}%`,
          background: 'var(--theme-bg-surface)',
          transform: slidIn ? 'translateX(0)' : 'translateX(100%)',
          // Width is deliberately left out: the resize handle must track the
          // cursor with no lag, only the open/close travel is animated.
          transition: `transform ${PANEL_SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize run panel"
          onMouseDown={onStartResize}
          className="relative w-[3px] shrink-0 cursor-col-resize bg-[var(--theme-border)] transition-colors hover:bg-[var(--theme-accent)]"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-4 py-2.5">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', tintSolid(runStatusHue(run.status)))} />
            <span className={cn('text-xs font-medium', tintText(runStatusHue(run.status)))}>
              {run.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-[var(--theme-text-muted)]">{formatAbsolute(run.startedAt)}</span>
            {run.completedAt && (
              <span className="text-xs text-[var(--theme-text-muted)]">
                · {formatDuration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close run panel"
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
              style={{ fontSize: 16, lineHeight: 1 }}
            >
              &times;
            </button>
          </div>

          <div className="min-h-0 flex-1">
            <WorkflowRunView run={run} stepRuns={stepRuns} deliverables={deliverables} />
          </div>

          {deliverables.length > 0 && (
            <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--theme-border)] px-4 py-2">
              <RunDeliverables deliverables={deliverables} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** The full recipe, read-only — editing opens the shared RoutineEditor modal. */
function ConfigTab({ routine, targetInfo }: { routine: Routine; targetInfo: TargetInfo }) {
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const update = useRoutineStore((s) => s.update);
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);

  const onToggleEnabled = async () => {
    setToggling(true);
    try {
      await update(routine.id, { enabled: !routine.enabled });
    } finally {
      setToggling(false);
    }
  };

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
            <span className={cn('ml-2 rounded px-1.5 py-0.5 font-mono text-[11px]', tint('purple'))}>
              @routine:{routine.slug}
            </span>
          </ConfigRow>
          <ConfigRow label="Description">
            <span className="text-[var(--theme-text-secondary)]">{routine.description || <span className="text-[var(--theme-text-muted)]">none</span>}</span>
          </ConfigRow>
          <ConfigRow label={targetInfo.kindLabel}>
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5', tint('purple'))}>
              <PrimitiveIcon kind={targetInfo.icon} size={12} tinted={false} className="shrink-0" />
              {targetInfo.label}
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
            {/* Re-enabling re-arms the schedule from now, server-side — a
                routine paused for a week does not replay its missed slots. */}
            <button
              type="button"
              disabled={toggling}
              onClick={() => void onToggleEnabled()}
              className="ml-3 rounded border border-[var(--theme-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {toggling ? '…' : routine.enabled ? 'Pause' : 'Resume'}
            </button>
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

/** One past run: a compact row that opens the slide-over. */
function HistoryRun({
  detail,
  selected,
  onSelect,
}: {
  detail: RoutineRunDetail;
  selected: boolean;
  onSelect: () => void;
}) {
  const { run, deliverables } = detail;
  return (
    <div className="border-b border-[var(--theme-border)] last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--theme-bg-hover)]',
          // The panel hides most of the list; the highlight is what tells you
          // which row it belongs to on the sliver still visible.
          selected && 'bg-[var(--theme-bg-hover)]',
        )}
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
        <span className="ml-auto text-xs text-[var(--theme-text-muted)]">›</span>
      </button>
    </div>
  );
}
