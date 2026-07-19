import { useMemo, useCallback } from 'react';
import type { Session, WorktreeSessionGroup, Ticket, TicketStatus } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint, tintText } from '../../../lib/tints';
import { PrBadge } from '../../ui/PrBadge';
import { useTicketStore } from '../../../stores/ticketStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePullRequestStore } from '../../../stores/pullRequestStore';
import { deriveDisplayStatus } from '../../../lib/deriveStatus';
import { StatusDot } from '../../ui/StatusDot';
import { NanoKanban } from '../../tickets/NanoKanban';
import { renderIcon } from '../../sidebar/PinnedIcons';
import { buildWorkspaceContext } from '../../../lib/templateUtils';
import { OverlaySyncButton } from '../../overlay-sync/OverlaySyncButton';

interface Props {
  worktree: WorktreeSessionGroup | null;
  repoOrg: string;
  repoName: string;
  /** The session currently displayed (if any) — used for status dot + floating toggle */
  activeSession: Session | null;
  /** Ticket linked to this worktree (if any) */
  ticket: Ticket | null;
  /** Visual emphasis when this pane is the focused split */
  splitFocused?: boolean;
}

// ——— Branch icon (shared) ———

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-secondary)]">
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="12" cy="7" r="1.5" />
      <path d="M5 5v6M5 7.5c0-1.5 1-3 4.5-3" />
    </svg>
  );
}


// ——— Main header ———

const ICON_BTN = 'flex h-6 w-6 items-center justify-center rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] transition-all hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)] overflow-hidden';

export function WorktreeHeader({ worktree, repoOrg, repoName, activeSession, ticket, splitFocused }: Props) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const workspaceActions = useSettingsStore((s) => s.settings.workspaceActions);
  const executePinnedAction = useSettingsStore((s) => s.executePinnedAction);
  const executeWorkspaceAction = useSettingsStore((s) => s.executeWorkspaceAction);

  // Workspace actions are bound to the ticket's workspace; without a ticket
  // there is no workspace, so only the global pinned actions show.
  const workspaceContext = useMemo(
    () => (ticket ? buildWorkspaceContext(ticket, basePath) : null),
    [ticket, basePath],
  );

  const handleStatusChange = useCallback((status: TicketStatus) => {
    if (ticket) updateTicket(ticket.id, { status });
  }, [ticket, updateTicket]);

  const status = useMemo(
    () => (activeSession ? deriveDisplayStatus(activeSession) : null),
    [activeSession],
  );

  // PR lookup
  const repoKey = repoOrg && repoName && !repoOrg.startsWith('_') ? `${repoOrg}/${repoName}` : null;
  const branch = worktree?.branch ?? activeSession?.worktreeBranch ?? null;
  const pr = usePullRequestStore((s) =>
    repoKey && branch ? s.pullsByRepo[repoKey]?.[branch] : undefined,
  );

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-3',
        splitFocused
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
          : 'border-[var(--theme-border)]',
      )}
      style={{ height: 'var(--header-height)' }}
    >
      {/* Icon + ticket id/title (or branch fallback when no ticket) */}
      <div className="flex items-center gap-1.5 min-w-0">
        <BranchIcon />
        {ticket ? (
          <span className="text-sm font-semibold text-[var(--theme-text-primary)] truncate">
            <span className="font-mono text-[var(--theme-text-secondary)]">#{ticket.displayId}</span>
            <span className="ml-1.5">{ticket.title}</span>
          </span>
        ) : (
          <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
            {worktree?.branch ?? activeSession?.worktreeBranch ?? activeSession?.tmuxName ?? 'session'}
          </span>
        )}
      </div>

      {/* Worktree sync status */}
      {worktree?.worktreeStatus === 'reconciling' && (
        <span className="shrink-0 text-xs text-[var(--theme-text-faint)] animate-pulse">syncing…</span>
      )}
      {(worktree?.worktreeStatus === 'repo_missing' || worktree?.worktreeStatus === 'unavailable') && (
        <span className="shrink-0 text-xs text-[var(--theme-warning,#f59e0b)]">not available locally</span>
      )}

      {/* Status dot + label (when session is active) */}
      {status && (
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusDot status={status.status} size="sm" />
          <span className={`text-[10px] ${status.textColor}`}>{status.label}</span>
          {status.warning && <span className={cn('text-[10px]', tintText('yellow'))}>&#9888;</span>}
        </div>
      )}

      {/* PR badge */}
      {pr && repoKey && <PrBadge pr={pr} org={repoOrg} name={repoName} />}

      {/* Agent assignee badge */}
      {ticket?.assignee && (
        <span className={cn('shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tint('purple'))}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
            <rect x="3" y="5" width="10" height="8" rx="1.5" />
            <path d="M5.5 8.5h1M9.5 8.5h1" />
            <path d="M6 11h4" />
            <line x1="8" y1="5" x2="8" y2="2.5" />
            <circle cx="8" cy="2" r="0.75" />
          </svg>
          {ticket.assignee}
        </span>
      )}

      {/* CWD path (when no ticket gives context) */}
      {!ticket && activeSession && (
        <span className="shrink-0 truncate text-xs text-[var(--theme-text-faint)] max-w-[40%]" title={activeSession.cwd}>
          {activeSession.cwd}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Sync overlay — capture gitignored files into the per-repo overlay */}
        <OverlaySyncButton ticket={ticket} worktree={worktree} repoOrg={repoOrg} repoName={repoName} />
        {(pinnedIcons.length > 0 || (workspaceContext && workspaceActions && workspaceActions.length > 0)) && (
          <div className="h-4 w-px bg-[var(--theme-border)]" />
        )}

        {/* Pinned actions + workspace actions */}
        {(pinnedIcons.length > 0 || (workspaceContext && workspaceActions && workspaceActions.length > 0)) && (
          <div className="flex items-center gap-1">
            {pinnedIcons.map((icon) => (
              <button
                key={icon.id}
                className={ICON_BTN}
                onClick={() => executePinnedAction(icon)}
                title={icon.label}
              >
                <span className="flex items-center justify-center" style={{ width: 14, height: 14 }}>
                  {renderIcon(icon, 14)}
                </span>
              </button>
            ))}
            {pinnedIcons.length > 0 && workspaceContext && workspaceActions && workspaceActions.length > 0 && (
              <div className="mx-0.5 h-4 w-px bg-[var(--theme-border)]" />
            )}
            {workspaceContext && workspaceActions?.map((action) => (
              <button
                key={action.id}
                className={ICON_BTN}
                onClick={() => executeWorkspaceAction(action, workspaceContext)}
                title={action.label}
              >
                {action.icon ? (
                  <span className="flex items-center justify-center" style={{ width: 14, height: 14 }}>
                    {renderIcon(action, 14)}
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold leading-none text-[var(--theme-text-secondary)]">
                    {action.label.charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Nano kanban status picker (when linked to a ticket) */}
        {ticket && (
          <div className="w-[100px] shrink-0">
            <NanoKanban status={ticket.status} onStatusChange={handleStatusChange} size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}
