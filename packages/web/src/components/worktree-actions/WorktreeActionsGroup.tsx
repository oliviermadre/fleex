import { useEffect, useMemo } from 'react';
import type { Ticket, WorktreeActionsView } from '@fleex/shared';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorktreeActionsStore, worktreeName } from '../../stores/worktreeActionsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { GROUP_LABEL } from '../work/topBarStyles';
import { WorktreeActionButton } from './WorktreeActionButton';
import { shortBranch } from './worktreeUi';

const EMPTY: WorktreeActionsView[] = [];

/** Button labels: the repo name, plus a branch tag when one repo has several worktrees in the ticket. */
export function worktreeLabels(views: WorktreeActionsView[]): string[] {
  const names = views.map(worktreeName);
  return views.map((v, i) => (names.filter((n) => n === names[i]).length > 1 ? `${names[i]}·${shortBranch(v.branch)}` : names[i]!));
}

/**
 * WORKTREES group (PRD §8.1): one button per worktree found in the ticket's
 * workspace, sorted by repo then branch. Renders nothing until the ticket has
 * a worktree.
 */
export function WorktreeActionsGroup({ ticket, separator = false }: { ticket: Ticket; separator?: boolean }) {
  const basePath = useSettingsStore((s) => s.settings.basePath);
  // Without the base path (settings not loaded yet) the workspace path is meaningless.
  const root = useMemo(() => (basePath ? buildWorkspaceContext(ticket, basePath).workspace_path : ''), [ticket, basePath]);
  const views = useWorktreeActionsStore((s) => (root ? s.byRoot[root] : undefined)) ?? EMPTY;
  const load = useWorktreeActionsStore((s) => s.load);

  useEffect(() => {
    if (root) void load(root);
  }, [root, load]);

  const labels = useMemo(() => worktreeLabels(views), [views]);
  if (!root || views.length === 0) return null;

  return (
    <>
      {separator && <div className="mx-1 h-4 w-px bg-[var(--theme-border)]" />}
      <span className={GROUP_LABEL}>WORKTREES</span>
      <div className="flex items-center gap-1.5">
        {views.map((view, i) => (
          <WorktreeActionButton key={view.path} view={view} root={root} ticketId={ticket.id} label={labels[i]!} />
        ))}
      </div>
    </>
  );
}
