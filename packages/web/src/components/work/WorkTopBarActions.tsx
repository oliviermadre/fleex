/**
 * The right-hand action cluster of the Work top bar (SPEC §2): the overlay-sync
 * button scoped to the selected task's workspace, then the PINNED global actions
 * and the ticket-scoped workspace actions (Cursor, Finder, localhost, Logs…).
 * Reuses the same settings primitives as WorktreeHeader; workspace actions only
 * appear when a ticket (hence a workspace) is selected.
 */
import { useMemo } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { renderIcon } from '../sidebar/PinnedIcons';
import { OverlaySyncButton } from '../overlay-sync/OverlaySyncButton';

const ICON_BTN =
  'flex h-6 w-6 items-center justify-center rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] transition-all hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)] overflow-hidden';

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

  const repo = useMemo(
    () => firstRepo((ticket?.links ?? []).filter((l) => l.type === 'repository').map((l) => l.ref)),
    [ticket],
  );

  const hasWorkspaceActions = !!workspaceContext && workspaceActions.length > 0;
  const hasActions = pinnedIcons.length > 0 || hasWorkspaceActions;

  if (!ticket && !hasActions) return null;

  return (
    <div className="flex items-center gap-1.5">
      <OverlaySyncButton ticket={ticket} worktree={null} repoOrg={repo.org} repoName={repo.name} />

      {hasActions && (
        <>
          <div className="h-4 w-px bg-[var(--theme-border)]" />
          <span className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--theme-text-faint)]">PINNED</span>
          <div className="flex items-center gap-1">
            {pinnedIcons.map((icon) => (
              <button key={icon.id} type="button" className={ICON_BTN} onClick={() => executePinnedAction(icon)} title={icon.label}>
                <span className="flex items-center justify-center" style={{ width: 14, height: 14 }}>
                  {renderIcon(icon, 14)}
                </span>
              </button>
            ))}
            {pinnedIcons.length > 0 && hasWorkspaceActions && (
              <div className="mx-0.5 h-4 w-px bg-[var(--theme-border)]" />
            )}
            {workspaceContext &&
              workspaceActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
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
        </>
      )}
    </div>
  );
}
