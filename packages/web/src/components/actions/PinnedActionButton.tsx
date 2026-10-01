import type { ReactNode } from 'react';
import { resolveClickAction } from '@fleex/shared';
import type { ActionRun, ActionStatus, ConditionalAction, PinnedIcon, StatusSnapshot, WorkspaceAction } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { useNow } from '../../lib/useNow';
import { usePinnedActionsStore } from '../../stores/pinnedActionsStore';
import { useUIStore } from '../../stores/uiStore';
import { useContextMenuPopover, FloatingPortal } from '../../hooks/usePopover';
import { Tooltip } from '../ui/Tooltip';
import { renderIcon } from '../sidebar/PinnedIcons';
import { STATUS_LABEL, compactBadge, formatAgo, runDuration, statusDotClass, statusTextClass, truncate } from './actionStatus';

const ICON_BTN =
  'relative flex h-6 w-6 items-center justify-center rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] transition-all hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)]';

export type ActionButtonKind = 'pinned' | 'workspace';

interface PinnedActionButtonProps {
  action: PinnedIcon | WorkspaceAction;
  kind: ActionButtonKind;
  /** Runs the click target (resolved from the status for pinned actions). */
  onRun: () => void;
  /** Settings preview: force a status instead of the live one (`null` = no probe). */
  statusOverride?: ActionStatus | null;
  /** Settings preview: tooltip text shown for the forced status. */
  tooltipOverride?: string;
  runningOverride?: boolean;
  highlight?: boolean;
  dim?: boolean;
}

function hasProbe(action: PinnedIcon | WorkspaceAction): action is PinnedIcon {
  return 'status' in action && !!action.status?.command?.trim();
}

/** What the tooltip says the click will do. */
export function clickLabel(action: PinnedIcon | WorkspaceAction, status: ActionStatus | null): string {
  const target = resolveClickAction(action, status);
  if (target.rule) return target.rule.label || truncate(target.actionValue, 48);
  if (target.actionType === 'url') {
    try {
      return `Open ${new URL(target.actionValue).host}`;
    } catch {
      return 'Open URL';
    }
  }
  return truncate(target.actionValue, 48) || action.label;
}

/**
 * One action button, shared by the Work top bar, the ticket header and the
 * Settings previews: icon, status dot (pulsing while probing), optional badge,
 * spinner while a run is in flight, an interactive tooltip that says what the
 * click will do, and a right-click menu with every action the button offers.
 */
export function PinnedActionButton({
  action,
  kind,
  onRun,
  statusOverride,
  tooltipOverride,
  runningOverride,
  highlight,
  dim,
}: PinnedActionButtonProps) {
  const snapshot = usePinnedActionsStore((s) => s.statuses[action.id]);
  const liveRunning = usePinnedActionsStore((s) => !!s.running[action.id]);
  const lastRun = usePinnedActionsStore((s) => s.runs[action.id]?.[0]);
  const menu = useContextMenuPopover();

  const probed = hasProbe(action);
  const status: ActionStatus | null = statusOverride !== undefined ? statusOverride : probed ? snapshot?.status ?? 'unknown' : null;
  const probing = statusOverride === undefined && !!snapshot?.probing;
  const running = runningOverride ?? liveRunning;
  const badge = statusOverride === undefined ? snapshot?.badge : undefined;

  return (
    <>
      <Tooltip
        interactive
        label={
          <ActionTooltipContent
            action={action}
            status={status}
            snapshot={statusOverride === undefined ? snapshot : undefined}
            tooltipOverride={tooltipOverride}
            lastRun={lastRun}
          />
        }
      >
        <button
          type="button"
          className={cn(
            ICON_BTN,
            running && 'pointer-events-none',
            highlight && 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]',
            dim && 'opacity-40',
          )}
          onClick={onRun}
          onContextMenu={(e) => {
            e.preventDefault();
            menu.openAt(e.clientX, e.clientY);
          }}
          disabled={running}
          aria-busy={running || undefined}
          aria-label={status ? `${action.label} — ${STATUS_LABEL[status]}` : action.label}
        >
          <span className={cn('flex items-center justify-center overflow-hidden', running && 'opacity-30')} style={{ width: 14, height: 14 }}>
            {action.icon ? (
              renderIcon(action, 14)
            ) : (
              <span className="text-[9px] font-semibold leading-none text-[var(--theme-text-secondary)]">
                {action.label.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          {status && (
            <span
              data-testid="action-status-dot"
              data-status={status}
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-[7px] w-[7px] rounded-full ring-2 ring-[var(--theme-bg-surface)]',
                statusDotClass(status),
                probing && 'animate-pulse motion-reduce:animate-none',
              )}
            />
          )}
          {badge && (
            // Anchored on the right edge: a wider badge grows over its own icon, never into the next button.
            <span
              title={badge}
              className="absolute -right-1 -top-1.5 whitespace-nowrap rounded bg-[var(--theme-border-input)] px-[3px] py-px text-[8px] font-semibold leading-none tabular-nums text-[var(--theme-text-primary)] ring-1 ring-[var(--theme-bg-surface)]"
            >
              {compactBadge(badge)}
            </span>
          )}
          {running && (
            <span
              role="status"
              aria-label="Running"
              className="absolute inset-[3px] animate-spin rounded-full border-2 border-transparent border-t-[var(--theme-accent)] motion-reduce:animate-none"
            />
          )}
        </button>
      </Tooltip>
      {menu.open && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            {...menu.getFloatingProps()}
            className="z-[9999] min-w-[220px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            <ActionMenuItems action={action} kind={kind} status={status} onRun={onRun} close={menu.close} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function ActionTooltipContent({
  action,
  status,
  snapshot,
  tooltipOverride,
  lastRun,
}: {
  action: PinnedIcon | WorkspaceAction;
  status: ActionStatus | null;
  snapshot?: StatusSnapshot;
  tooltipOverride?: string;
  lastRun?: ActionRun;
}) {
  const now = useNow();
  const refresh = usePinnedActionsStore((s) => s.refresh);
  const openLogs = usePinnedActionsStore((s) => s.openLogs);
  const tooltip = tooltipOverride ?? snapshot?.tooltip;

  return (
    <div className="flex w-[280px] flex-col gap-1.5 whitespace-normal font-normal">
      <div className="flex items-center gap-2">
        <span className="truncate font-semibold">{action.label || 'Untitled'}</span>
        {status && (
          <span className={cn('ml-auto flex shrink-0 items-center gap-1 text-[10.5px] font-medium', statusTextClass(status))}>
            <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(status))} />
            {STATUS_LABEL[status]}
          </span>
        )}
      </div>
      {status && tooltip && (
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-[var(--theme-bg-base)] px-2 py-1.5 font-mono text-[10.5px] leading-snug text-[var(--theme-text-secondary)]">
          {tooltip}
        </pre>
      )}
      {status && snapshot && (
        <div className="flex items-center gap-1 text-[10.5px] text-[var(--theme-text-muted)]">
          Checked {formatAgo(snapshot.checkedAt, now)} ·
          <button type="button" className="text-[var(--theme-accent)] hover:underline" onClick={() => void refresh(action.id)}>
            ⟳ Refresh
          </button>
        </div>
      )}
      <div className="rounded bg-[var(--theme-accent-muted)] px-2 py-1 text-[10.5px] text-[var(--theme-text-primary)]">
        ▶ Click: {clickLabel(action, status)}
      </div>
      {lastRun?.finishedAt && (
        <div className="flex items-center gap-1 text-[10.5px] text-[var(--theme-text-muted)]">
          <RunMark run={lastRun} /> Last run · {lastRun.timedOut ? 'timeout' : `exit ${lastRun.exitCode ?? '—'}`} · {runDuration(lastRun.startedAt, lastRun.finishedAt)} ·
          <button
            type="button"
            className="text-[var(--theme-accent)] hover:underline"
            onClick={() => openLogs({ sourceId: action.id, label: action.label, runId: lastRun.runId })}
          >
            View logs
          </button>
        </div>
      )}
    </div>
  );
}

export function RunMark({ run }: { run: ActionRun }) {
  const ok = run.exitCode === 0 && !run.timedOut;
  return <span className={ok ? statusTextClass('ok') : statusTextClass('ko')}>{ok ? '✓' : '✗'}</span>;
}

function ActionMenuItems({
  action,
  kind,
  status,
  onRun,
  close,
}: {
  action: PinnedIcon | WorkspaceAction;
  kind: ActionButtonKind;
  status: ActionStatus | null;
  onRun: () => void;
  close: () => void;
}) {
  const run = usePinnedActionsStore((s) => s.run);
  const refresh = usePinnedActionsStore((s) => s.refresh);
  const openLogs = usePinnedActionsStore((s) => s.openLogs);
  const openActionSettings = useUIStore((s) => s.openActionSettings);
  const resolved = resolveClickAction(action, status);
  const rules: ConditionalAction[] = hasProbe(action) ? action.conditionalActions ?? [] : [];

  const runTarget = (target: { label: string; actionType: 'url' | 'shell'; actionValue: string; timeoutSec?: number }) => {
    if (target.actionType === 'url') window.open(target.actionValue, '_blank');
    else void run({ sourceId: action.id, sourceKind: 'pinned', label: target.label, command: target.actionValue, ...(target.timeoutSec ? { timeoutSec: target.timeoutSec } : {}) });
  };
  const pick = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <>
      {kind === 'pinned' && rules.length > 0 ? (
        <>
          <MenuItem
            primary={!resolved.rule}
            onClick={pick(() => runTarget({ label: action.label, actionType: action.actionType, actionValue: action.actionValue, timeoutSec: action.actionTimeoutSec }))}
            hint="default"
          >
            {action.label}
          </MenuItem>
          {rules.map((rule) => (
            <MenuItem
              key={rule.id}
              primary={resolved.rule?.id === rule.id}
              dim={!(rule.when?.length ? status !== null && rule.when.includes(status) : true)}
              onClick={pick(() => runTarget({ label: rule.label || action.label, actionType: rule.actionType, actionValue: rule.actionValue, timeoutSec: rule.timeoutSec }))}
              hint={
                <span className="flex gap-0.5">
                  {(rule.when ?? []).map((s) => <span key={s} className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(s))} />)}
                </span>
              }
            >
              {rule.label || rule.actionValue}
            </MenuItem>
          ))}
        </>
      ) : (
        <MenuItem primary onClick={pick(onRun)}>Run {action.label}</MenuItem>
      )}
      <div className="my-1 border-t border-[var(--theme-border)]" />
      {status && <MenuItem onClick={pick(() => void refresh(action.id))}>Refresh status</MenuItem>}
      <MenuItem onClick={pick(() => openLogs({ sourceId: action.id, label: action.label }))}>View logs</MenuItem>
      <MenuItem onClick={pick(() => openActionSettings(kind === 'pinned' ? 'pinned' : 'ticket', action.id))}>Edit…</MenuItem>
    </>
  );
}

function MenuItem({
  children,
  onClick,
  primary,
  dim,
  hint,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  dim?: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
        primary ? 'font-medium text-[var(--theme-text-primary)]' : dim ? 'text-[var(--theme-text-faint)]' : 'text-[var(--theme-text-secondary)]',
      )}
      onClick={onClick}
    >
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[10px] text-[var(--theme-text-faint)]">{hint}</span>}
    </button>
  );
}
