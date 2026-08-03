import type { RepositorySummary } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { useUIStore } from '../../stores/uiStore';

import { GitHubIcon } from './icons';
import { RepoItem } from './RepoItem';

interface Props {
  org: string;
  repos: RepositorySummary[];
  onRemove: (key: string) => void;
}

export function OrgGroup({ org, repos, onRemove }: Props) {
  const groupId = `org:${org}`;
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const collapsed = collapsedGroups.has(groupId);
  const isSelectedOrg = selectedRepoKey?.startsWith(`${org}/`) ?? false;

  return (
    <div className="my-1.5">
      <button
        className="group flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-[var(--theme-bg-hover)]"
        onClick={() => toggleGroup(groupId)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-[var(--theme-text-muted)] transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90',
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span
          className={cn(
            'truncate text-[11px] font-bold uppercase tracking-wider',
            isSelectedOrg ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]',
          )}
        >
          {org}
        </span>
        <a
          href={`https://github.com/${org}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[var(--theme-text-muted)] opacity-0 transition-opacity hover:text-[var(--theme-text-secondary)] group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <GitHubIcon size={14} />
        </a>
      </button>
      {!collapsed &&
        repos.map((repo) => (
          <RepoItem key={`${repo.org}/${repo.name}`} summary={repo} onRemove={onRemove} />
        ))}
    </div>
  );
}
