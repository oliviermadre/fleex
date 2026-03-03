import { useMemo } from 'react';
import type { Session } from '@asm/shared';
import { useSettingsStore } from '../../stores/settingsStore';
import { useClaudeUsage } from '../../hooks/useClaudeUsage';
import { renderIcon } from '../sidebar/PinnedIcons';
import { UsageGauges } from '../sidebar/UsageGauges';
import { buildWorktreeContext } from '../../lib/templateUtils';
import type { PinnedIcon, WorktreeAction } from '../../stores/settingsStore';

const ICON_BTN = 'flex h-7 w-7 items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] transition-all hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)] overflow-hidden';

function PinnedToolbarButton({ icon }: { icon: PinnedIcon }) {
  const executePinnedAction = useSettingsStore((s) => s.executePinnedAction);

  return (
    <button
      className={ICON_BTN}
      onClick={() => executePinnedAction(icon)}
      title={icon.label}
    >
      <span className="flex items-center justify-center" style={{ width: 16, height: 16 }}>
        {renderIcon(icon, 16)}
      </span>
    </button>
  );
}

function WorktreeToolbarButton({ action, context }: { action: WorktreeAction; context: ReturnType<typeof buildWorktreeContext> }) {
  const executeWorktreeAction = useSettingsStore((s) => s.executeWorktreeAction);

  return (
    <button
      className={ICON_BTN}
      onClick={() => executeWorktreeAction(action, context)}
      title={action.label}
    >
      {action.icon ? (
        <span className="flex items-center justify-center" style={{ width: 16, height: 16 }}>
          {renderIcon(action, 16)}
        </span>
      ) : (
        <span className="text-[10px] font-semibold leading-none text-[var(--theme-text-secondary)]">
          {action.label.charAt(0).toUpperCase()}
        </span>
      )}
    </button>
  );
}

interface TopToolbarProps {
  /** Worktree context — preferred source for worktree actions */
  worktree?: { org: string; repo: string; branch: string; path: string };
  /** Fallback: extract worktree info from a session (backward compat for SessionPane) */
  session?: Session;
}

export function TopToolbar({ worktree, session }: TopToolbarProps) {
  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const worktreeActions = useSettingsStore((s) => s.settings.worktreeActions);
  const { usage, loading } = useClaudeUsage();

  const worktreeContext = useMemo(() => {
    if (worktree) return buildWorktreeContext(worktree.org, worktree.repo, worktree.branch, worktree.path);
    if (session?.repositoryOrg && session?.repositoryName && session?.worktreeBranch)
      return buildWorktreeContext(session.repositoryOrg, session.repositoryName, session.worktreeBranch, session.cwd);
    return null;
  }, [worktree, session?.repositoryOrg, session?.repositoryName, session?.worktreeBranch, session?.cwd]);

  const hasWorktreeActions = worktreeContext && worktreeActions && worktreeActions.length > 0;
  const hasPinnedIcons = pinnedIcons.length > 0;

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--theme-border-subtle)] bg-[var(--theme-bg-base)] px-2">
      <div className="flex items-center gap-1">
        {pinnedIcons.map((icon) => (
          <PinnedToolbarButton key={icon.id} icon={icon} />
        ))}
        {hasPinnedIcons && hasWorktreeActions && (
          <div className="mx-1 h-5 w-px bg-[var(--theme-border)]" />
        )}
        {hasWorktreeActions && worktreeActions.map((action) => (
          <WorktreeToolbarButton key={action.id} action={action} context={worktreeContext} />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <UsageGauges usage={usage} loading={loading} />
        <span className="rounded border border-[var(--theme-border-subtle)] px-2 py-0.5 text-[10px] text-[var(--theme-text-faint)]">
          &#8984;K command palette
        </span>
      </div>
    </div>
  );
}
