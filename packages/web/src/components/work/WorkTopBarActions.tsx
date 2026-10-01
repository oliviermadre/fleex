/**
 * The right-hand action cluster of the Work top bar (SPEC §2), in two labelled
 * groups split by a separator: the PINNED global actions, then the TICKET
 * actions scoped to the selected ticket's workspace (Cursor, Finder, localhost,
 * Logs…) ending with the system-provided overlay-sync button. Reuses the same
 * settings primitives as WorktreeHeader; the TICKET group only appears when a
 * ticket (hence a workspace) is selected.
 */
import { useMemo } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { OverlaySyncButton } from '../overlay-sync/OverlaySyncButton';
import { PinnedActionButton } from '../actions/PinnedActionButton';
import { GROUP_LABEL } from './topBarStyles';

/** First repository link "org/name" of a ticket, split for the overlay button. */
function firstRepo(refs: string[]): { org: string; name: string } {
  const ref = refs[0];
  if (!ref) return { org: '', name: '' };
  const slash = ref.indexOf('/');
  return slash > 0 ? { org: ref.slice(0, slash), name: ref.slice(slash + 1) } : { org: '', name: '' };
}

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

  const repo = useMemo(
    () => firstRepo((ticket?.links ?? []).filter((l) => l.type === 'repository').map((l) => l.ref)),
    [ticket],
  );

  const hasPinned = pinnedIcons.length > 0;

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

      {hasPinned && workspaceContext && <div className="mx-1 h-4 w-px bg-[var(--theme-border)]" />}

      {workspaceContext && (
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
            <OverlaySyncButton ticket={ticket} worktree={null} repoOrg={repo.org} repoName={repo.name} />
          </div>
        </>
      )}
    </div>
  );
}
