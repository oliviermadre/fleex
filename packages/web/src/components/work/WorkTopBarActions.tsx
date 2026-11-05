/**
 * The right-hand action cluster of the Work top bar (SPEC §2), in labelled
 * groups split by separators: the PINNED global actions, the TICKET actions
 * scoped to the selected ticket's workspace (Cursor, Finder, localhost,
 * Logs…), then WORKTREES — one button per worktree of the ticket, whose menu
 * also holds Sync overlay. Reuses the same settings primitives as
 * WorktreeHeader; TICKET and WORKTREES only appear when a ticket is selected.
 */
import { useMemo } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { WorktreeActionsGroup } from '../worktree-actions/WorktreeActionsGroup';
import { PinnedActionButton } from '../actions/PinnedActionButton';
import { GROUP_LABEL } from './topBarStyles';

export function WorkTopBarActions({ ticketId }: { ticketId: string | null }) {
  const ticket = useTicketStore((s) => (ticketId ? s.tickets.find((t) => t.id === ticketId) ?? null : null));
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const allPinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const allWorkspaceActions = useSettingsStore((s) => s.settings.workspaceActions);
  // Hidden actions (Settings › Actions "Visible" off) stay configured but out of the bar.
  const pinnedIcons = useMemo(() => allPinnedIcons.filter((i) => i.enabled !== false), [allPinnedIcons]);
  const workspaceActions = useMemo(() => (allWorkspaceActions ?? []).filter((a) => a.enabled !== false), [allWorkspaceActions]);
  const executePinnedAction = useSettingsStore((s) => s.executePinnedAction);
  const executeWorkspaceAction = useSettingsStore((s) => s.executeWorkspaceAction);

  // Workspace actions are bound to the ticket's workspace; without a ticket
  // there is no workspace, so only the global pinned actions show.
  const workspaceContext = useMemo(
    () => (ticket ? buildWorkspaceContext(ticket, basePath) : null),
    [ticket, basePath],
  );

  const hasPinned = pinnedIcons.length > 0;
  // The TICKET group used to always hold Sync overlay; that moved into the worktree menus.
  const hasTicketActions = !!workspaceContext && workspaceActions.length > 0;

  if (!hasPinned && !workspaceContext) return null;

  return (
    <div className="flex items-center gap-1.5">
      {hasPinned && (
        <>
          <span className={GROUP_LABEL}>PINNED</span>
          <div className="flex items-center gap-2">
            {pinnedIcons.map((icon) => (
              <PinnedActionButton key={icon.id} action={icon} kind="pinned" onRun={() => executePinnedAction(icon)} />
            ))}
          </div>
        </>
      )}

      {hasPinned && hasTicketActions && <div className="mx-1 h-4 w-px bg-[var(--theme-border)]" />}

      {hasTicketActions && workspaceContext && (
        <>
          <span className={GROUP_LABEL}>TICKET</span>
          <div className="flex items-center gap-2">
            {workspaceActions.map((action) => (
              <PinnedActionButton
                key={action.id}
                action={action}
                kind="workspace"
                onRun={() => executeWorkspaceAction(action, workspaceContext)}
              />
            ))}
          </div>
        </>
      )}

      {ticket && <WorktreeActionsGroup ticket={ticket} separator={hasPinned || hasTicketActions} />}
    </div>
  );
}
