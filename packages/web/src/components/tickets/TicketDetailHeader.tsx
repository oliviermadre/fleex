import { useMemo } from 'react';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import type { Ticket } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { getStatusBadgeClass } from '../../lib/statusColors';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { OverlaySyncButton } from '../overlay-sync/OverlaySyncButton';
import { PinnedActionButton } from '../actions/PinnedActionButton';

export function TicketDetailHeader({ ticket }: { ticket: Ticket }) {
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const allPinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const allWorkspaceActions = useSettingsStore((s) => s.settings.workspaceActions);
  const pinnedIcons = useMemo(() => allPinnedIcons.filter((i) => i.enabled !== false), [allPinnedIcons]);
  const workspaceActions = useMemo(() => (allWorkspaceActions ?? []).filter((a) => a.enabled !== false), [allWorkspaceActions]);
  const executePinnedAction = useSettingsStore((s) => s.executePinnedAction);
  const executeWorkspaceAction = useSettingsStore((s) => s.executeWorkspaceAction);

  // A workspace always exists (conceptually) for a ticket: its folder is
  // deterministic, so this context is always available — even with no session.
  const workspaceContext = useMemo(
    () => buildWorkspaceContext(ticket, basePath),
    [ticket, basePath],
  );

  const hasWorkspaceActions = workspaceActions && workspaceActions.length > 0;
  const hasActions = pinnedIcons.length > 0 || hasWorkspaceActions;

  return (
    <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
      <button
        className="rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => selectTicket(null)}
        title="Back to board"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="10,4 6,8 10,12" />
        </svg>
      </button>

      <span className="text-xs font-medium text-[var(--theme-text-muted)]">
        #{ticket.displayId}
      </span>

      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getStatusBadgeClass(ticket.status) || 'text-[var(--theme-text-secondary)] bg-[var(--theme-bg-overlay)]')}>
        {TICKET_STATUS_LABELS[ticket.status]}
      </span>

      <span className="flex-1 truncate text-sm font-medium text-[var(--theme-text-primary)]">
        {ticket.title}
      </span>

      {/* Sync overlay + pinned (global) actions + workspace actions — mirrors WorktreeHeader */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Sync overlay — opens on the ticket's workspace root; the server walks
            it for worktrees. The repo props are only used for the no-ticket case. */}
        <OverlaySyncButton ticket={ticket} worktree={null} repoOrg="" repoName="" />
        {hasActions && (
          <div className="flex items-center gap-1">
            {pinnedIcons.map((icon) => (
              <PinnedActionButton key={icon.id} action={icon} kind="pinned" onRun={() => executePinnedAction(icon)} />
            ))}
            {pinnedIcons.length > 0 && hasWorkspaceActions && (
              <div className="mx-0.5 h-4 w-px bg-[var(--theme-border)]" />
            )}
            {workspaceActions.map((action) => (
              <PinnedActionButton
                key={action.id}
                action={action}
                kind="workspace"
                onRun={() => executeWorkspaceAction(action, workspaceContext)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
