import type { WorktreeSessionGroup } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { SessionItem } from './SessionItem';
import { cn } from '../../lib/cn';

interface Props {
  worktree: WorktreeSessionGroup;
  repoGroupId: string;
}

export function WorktreeGroup({ worktree, repoGroupId }: Props) {
  const groupId = `${repoGroupId}:${worktree.branch}`;
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const collapsed = collapsedGroups.has(groupId);

  return (
    <div className="ml-3">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-zinc-800/50"
        onClick={() => toggleGroup(groupId)}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-zinc-600 transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90'
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-500">
          <path d="M6 3v10M2 6l4-3 4 3M10 8l4 3-4 3" />
        </svg>
        <span className="truncate text-[11px] text-zinc-400">{worktree.branch}</span>
        <span className="ml-auto text-[10px] text-zinc-600">{worktree.sessions.length}</span>
      </button>
      {!collapsed &&
        worktree.sessions.map((session) => (
          <SessionItem key={session.id} session={session} />
        ))}
    </div>
  );
}
