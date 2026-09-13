/**
 * Work status bar (26px, full width): a breadcrumb on the left
 * (Board › #num Title › ⎇ repo · branch) and, on the right, the selected task's
 * live state — agent activity, PR, worktrees, sessions, status and cost — each a
 * hairline-separated segment. Segment click-targets are wired as their panels land.
 */
import type { WorkTask } from './types';

interface Props {
  task: WorkTask | null;
}

export function WorkStatusBar({ task }: Props) {
  return (
    <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 text-[11px] text-[var(--theme-text-muted)]">
      <div className="flex min-w-0 items-center gap-1.5">
        {task ? (
          <>
            {task.boardName && <Segment>{task.boardName}</Segment>}
            <Chevron />
            <Segment>
              <span className="font-mono text-[var(--theme-text-faint)]">#{task.number}</span>{' '}
              <span className="truncate text-[var(--theme-text-secondary)]">{task.title}</span>
            </Segment>
            {task.worktrees[0] && (
              <>
                <Chevron />
                <Segment>
                  <span className="font-mono">
                    ⎇ {task.worktrees[0].repo}
                    {task.worktrees[0].branch ? ` · ${task.worktrees[0].branch}` : ''}
                    {task.worktrees.length > 1 ? ` +${task.worktrees.length - 1}` : ''}
                  </span>
                </Segment>
              </>
            )}
          </>
        ) : (
          <span className="text-[var(--theme-text-faint)]">No task selected</span>
        )}
      </div>

      {task && (
        <div className="flex shrink-0 items-center gap-2">
          {task.activityDetail && <span>{task.activityDetail}</span>}
          {task.pr && (
            <Hair>
              <span className="font-mono">{task.pr.ref}</span>
              {task.pr.additions != null && (task.pr.additions > 0 || (task.pr.deletions ?? 0) > 0) && (
                <span className="font-mono text-[10px]">
                  <span className="text-[var(--tint-green-text)]">+{task.pr.additions}</span>{' '}
                  <span className="text-[var(--tint-red-text)]">−{task.pr.deletions ?? 0}</span>
                </span>
              )}
            </Hair>
          )}
          {task.worktrees.length > 0 && <Hair>{task.worktrees.length} repos</Hair>}
          <Hair><span className="capitalize">{task.status}</span></Hair>
          {task.cost != null && task.cost > 0 && <Hair>${task.cost.toFixed(2)}</Hair>}
        </div>
      )}
    </footer>
  );
}

function Segment({ children }: { children: React.ReactNode }) {
  return <span className="flex min-w-0 items-center gap-1 truncate">{children}</span>;
}
function Chevron() {
  return <span className="text-[var(--theme-text-faint)]">›</span>;
}
function Hair({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 border-l border-[var(--theme-border)] pl-2">{children}</span>
  );
}
