import type { SessionGroup } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { WorktreeGroup } from './WorktreeGroup';
import { cn } from '../../lib/cn';

interface Props {
  group: SessionGroup;
}

export function RepositoryGroup({ group }: Props) {
  const groupId = `${group.repositoryOrg}/${group.repositoryName}`;
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const collapsed = collapsedGroups.has(groupId);

  return (
    <div className="border-b border-zinc-800/50">
      <button
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-zinc-800/50"
        onClick={() => toggleGroup(groupId)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-zinc-500 transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90'
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span className="truncate text-xs font-semibold text-zinc-300">
          {group.repositoryOrg}/{group.repositoryName}
        </span>
      </button>
      {!collapsed &&
        group.worktrees.map((wt) => (
          <WorktreeGroup
            key={wt.branch}
            worktree={wt}
            repoGroupId={groupId}
          />
        ))}
    </div>
  );
}
