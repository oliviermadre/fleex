import { useMemo } from 'react';

import { TICKET_STATUS_LABELS } from '@fleex/shared';
import type { Ticket } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { getStatusBadgeClass } from '../../lib/statusColors';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { OverlaySyncButton } from '../overlay-sync/OverlaySyncButton';
import { renderIcon } from '../sidebar/PinnedIcons';

const ICON_BTN =
  'flex h-6 w-6 items-center justify-center rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] transition-all hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)] overflow-hidden';

export function TicketDetailHeader({ ticket }: { ticket: Ticket }) {
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const workspaceActions = useSettingsStore((s) => s.settings.workspaceActions);
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
    <div
      className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3"
      style={{ height: 'var(--header-height)' }}
    >
      <button
        className="rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => selectTicket(null)}
        title="Back to board"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="10,4 6,8 10,12" />
        </svg>
      </button>

      <span className="text-xs font-medium text-[var(--theme-text-muted)]">
        #{ticket.displayId}
      </span>

      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-medium',
          getStatusBadgeClass(ticket.status) ||
            'text-[var(--theme-text-secondary)] bg-[var(--theme-bg-overlay)]',
        )}
      >
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
              <button
                key={icon.id}
                className={ICON_BTN}
                onClick={() => executePinnedAction(icon)}
                title={icon.label}
              >
                <span
                  className="flex items-center justify-center"
                  style={{ width: 14, height: 14 }}
                >
                  {renderIcon(icon, 14)}
                </span>
              </button>
            ))}
            {pinnedIcons.length > 0 && hasWorkspaceActions && (
              <div className="mx-0.5 h-4 w-px bg-[var(--theme-border)]" />
            )}
            {workspaceActions?.map((action) => (
              <button
                key={action.id}
                className={ICON_BTN}
                onClick={() => executeWorkspaceAction(action, workspaceContext)}
                title={action.label}
              >
                {action.icon ? (
                  <span
                    className="flex items-center justify-center"
                    style={{ width: 14, height: 14 }}
                  >
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
      </div>
    </div>
  );
}
