import type { RepositorySummary } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { GitHubIcon } from './icons';
import { RepoItem } from './RepoItem';
import { cn } from '../../lib/cn';

interface Props {
  org: string;
  repos: RepositorySummary[];
}

const GROUP_COLORS = [
  'rgba(245, 158, 11, 0.08)',
  'rgba(16, 185, 129, 0.08)',
  'rgba(59, 130, 246, 0.08)',
  'rgba(236, 72, 153, 0.08)',
  'rgba(139, 92, 246, 0.08)',
  'rgba(249, 115, 22, 0.08)',
  'rgba(20, 184, 166, 0.08)',
  'rgba(239, 68, 68, 0.08)',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function OrgGroup({ org, repos }: Props) {
  const groupId = `org:${org}`;
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const collapsed = collapsedGroups.has(groupId);
  const bgColor = GROUP_COLORS[hashString(org) % GROUP_COLORS.length];

  return (
    <div
      className="mx-1.5 my-1 overflow-hidden rounded-lg"
      style={{ backgroundColor: bgColor }}
    >
      <button
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-zinc-800/30"
        onClick={() => toggleGroup(groupId)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-zinc-500 transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90',
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span className="truncate text-sm font-semibold text-zinc-200">{org}</span>
        <a
          href={`https://github.com/${org}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-zinc-500 hover:text-zinc-300"
          onClick={(e) => e.stopPropagation()}
        >
          <GitHubIcon size={14} />
        </a>
      </button>
      {!collapsed && repos.map((repo) => (
        <RepoItem key={`${repo.org}/${repo.name}`} summary={repo} />
      ))}
    </div>
  );
}
