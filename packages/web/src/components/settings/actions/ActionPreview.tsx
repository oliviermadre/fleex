import { useEffect } from 'react';
import { ACTION_STATUSES, resolveClickAction } from '@fleex/shared';
import type { ActionRun, ActionStatus, PinnedIcon, WorkspaceAction } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import type { ActionsScope } from '../../../stores/uiStore';
import { ActionTooltipContent, PinnedActionButton, RunMark } from '../../actions/PinnedActionButton';
import { STATUS_LABEL, runDuration, statusDotClass } from '../../actions/actionStatus';
import type { ActionDraft } from './actionModel';
import { isEnabled } from './actionModel';
import { SECTION } from './shared';

export type Simulation = ActionStatus | 'running' | null;

const EMPTY_RUNS: ActionRun[] = [];
const CARD = cn(SECTION, 'p-3.5');
const HEAD = 'mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]';

/**
 * Sticky preview of the action being edited: the bar as it will look (other
 * actions dimmed), a status simulator that forces each state without waiting
 * for a real probe, the tooltip and right-click menu for that state, and the
 * latest runs. Everything follows the draft keystroke by keystroke; nothing
 * here persists.
 */
export function ActionPreview({
  draft,
  scope,
  list,
  simulation,
  onSimulate,
}: {
  draft: ActionDraft;
  scope: ActionsScope;
  list: (PinnedIcon | WorkspaceAction)[];
  simulation: Simulation;
  onSimulate: (s: Simulation) => void;
}) {
  const snapshot = usePinnedActionsStore((s) => s.statuses[draft.id]);
  const runs = usePinnedActionsStore((s) => s.runs[draft.id] ?? EMPTY_RUNS);
  const loadRuns = usePinnedActionsStore((s) => s.loadRuns);
  const openLogs = usePinnedActionsStore((s) => s.openLogs);

  useEffect(() => {
    void loadRuns(draft.id);
  }, [draft.id, loadRuns]);

  const probed = scope === 'pinned' && !!draft.status;
  const realStatus: ActionStatus | null = probed ? snapshot?.status ?? 'unknown' : null;
  const forced = simulation && simulation !== 'running' ? simulation : null;
  const status = probed ? forced ?? realStatus : null;
  // The real probe output only describes the real state; a simulated one says so.
  const tooltipOverride = forced && forced !== realStatus ? '(example) probe output for this state' : undefined;

  const others = list.filter(isEnabled);
  const bar = others.some((a) => a.id === draft.id) ? others.map((a) => (a.id === draft.id ? draft : a)) : [...others, draft];
  const resolved = resolveClickAction(draft, status);

  return (
    <aside className="sticky top-0 flex flex-col gap-3" aria-label="Preview">
      <div className={CARD}>
        <div className={HEAD}>Preview <span className="ml-auto normal-case tracking-normal text-[var(--theme-text-faint)]">live</span></div>
        <div className="flex items-center justify-center gap-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-2 py-3.5">
          <span className="mr-1 text-[9.5px] font-semibold tracking-wider text-[var(--theme-text-faint)]">{scope === 'pinned' ? 'PINNED' : 'TICKET'}</span>
          {bar.map((a) =>
            a.id === draft.id ? (
              <PinnedActionButton
                key={a.id}
                action={draft}
                kind={scope === 'pinned' ? 'pinned' : 'workspace'}
                onRun={() => {}}
                statusOverride={status}
                tooltipOverride={tooltipOverride}
                runningOverride={simulation === 'running' ? true : undefined}
                highlight
              />
            ) : (
              <PinnedActionButton key={a.id} action={a} kind={scope === 'pinned' ? 'pinned' : 'workspace'} onRun={() => {}} dim />
            ),
          )}
        </div>
        {probed && (
          <>
            <div className="mt-2.5 flex flex-wrap gap-1" role="group" aria-label="Simulate a status">
              {ACTION_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={status === s && simulation !== 'running'}
                  className={cn(
                    'flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px]',
                    status === s && simulation !== 'running' ? 'border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'border-[var(--theme-border)] text-[var(--theme-text-muted)]',
                  )}
                  onClick={() => onSimulate(s)}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(s))} /> {STATUS_LABEL[s]}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={simulation === 'running'}
                className={cn('flex h-6 items-center rounded-md border px-2 text-[11px]', simulation === 'running' ? 'border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'border-[var(--theme-border)] text-[var(--theme-text-muted)]')}
                onClick={() => onSimulate('running')}
              >
                ⟳ Run
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--theme-text-faint)]">
              {simulation ? (
                <>Simulated. <button type="button" className="text-[var(--theme-accent)] hover:underline" onClick={() => onSimulate(null)}>Back to the real state</button></>
              ) : (
                'Real current state.'
              )}
            </p>
          </>
        )}
        <div className="mt-3 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2.5 py-2 text-[11px] text-[var(--theme-text-primary)]">
          <ActionTooltipContent action={draft} status={status} snapshot={forced ? undefined : snapshot} tooltipOverride={tooltipOverride} lastRun={runs[0]} />
        </div>
      </div>

      {probed && (
        <div className={CARD}>
          <div className={HEAD}>Right-click</div>
          <div className="flex flex-col text-xs">
            <MenuLine primary={!resolved.rule}>{draft.label || 'Default action'} <span className="ml-auto text-[10px] text-[var(--theme-text-faint)]">default</span></MenuLine>
            {(draft.conditionalActions ?? []).map((r) => (
              <MenuLine key={r.id} primary={resolved.rule?.id === r.id} dim={!(status && r.when?.includes(status))}>
                {r.label || 'Untitled rule'}
                <span className="ml-auto flex gap-0.5">{(r.when ?? []).map((s) => <span key={s} className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(s))} />)}</span>
              </MenuLine>
            ))}
            <div className="my-1 border-t border-[var(--theme-border)]" />
            <MenuLine>Refresh status</MenuLine>
            <MenuLine>View logs</MenuLine>
            <MenuLine>Edit…</MenuLine>
          </div>
        </div>
      )}

      <div className={CARD}>
        <div className={HEAD}>Latest runs</div>
        {runs.length === 0 ? (
          <p className="text-[11px] text-[var(--theme-text-faint)]">No run yet.</p>
        ) : (
          <div className="flex flex-col">
            {runs.slice(0, 4).map((r) => (
              <button
                key={r.runId}
                type="button"
                className="grid grid-cols-[14px_1fr_auto] items-center gap-2 rounded px-1.5 py-1 text-left text-[11.5px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
                onClick={() => openLogs({ sourceId: draft.id, label: draft.label, runId: r.runId })}
              >
                {r.finishedAt ? <RunMark run={r} /> : <span>…</span>}
                <span className="truncate">{r.label} <span className="font-mono text-[10.5px] text-[var(--theme-text-faint)]">{r.timedOut ? 'timeout' : `exit ${r.exitCode ?? '—'}`} · {runDuration(r.startedAt, r.finishedAt)}</span></span>
                <span className="font-mono text-[10.5px] text-[var(--theme-text-faint)]">{new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function MenuLine({ children, primary, dim }: { children: React.ReactNode; primary?: boolean; dim?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 rounded px-1.5 py-1', primary ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : dim ? 'text-[var(--theme-text-faint)]' : 'text-[var(--theme-text-secondary)]')}>
      {children}
    </div>
  );
}
