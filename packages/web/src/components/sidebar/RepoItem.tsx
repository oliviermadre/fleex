import type { RepositorySummary } from '@fleex/shared';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import { useCallback } from 'react';

interface Props {
  summary: RepositorySummary;
}

export function RepoItem({ summary }: Props) {
  const navigate = useNavigate();
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const openScratchpadForRepo = useUIStore((s) => s.openScratchpadForRepo);
  const key = `${summary.org}/${summary.name}`;
  const isSelected = selectedRepoKey === key;
  const loading = summary.lastFetchedAt === null;

  const handleScratchpadClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      openScratchpadForRepo(key);
    },
    [openScratchpadForRepo, key],
  );

  return (
    <button
      className={cn(
        'group flex min-w-0 w-full flex-col gap-0.5 py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
        isSelected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
      onClick={() => navigate(`/repositories/${key}`, { replace: true })}
    >
      <div className="flex items-center w-full">
        <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{summary.name}</span>
        <span
          role="button"
          className="ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.08]"
          onClick={handleScratchpadClick}
          title="Open scratchpad"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7a1.5 1.5 0 01-1.5 1.5H5l-3 2.5V3.5z" />
          </svg>
        </span>
      </div>
      {loading ? (
        <div className="flex gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="h-3 w-6 animate-pulse rounded bg-[var(--theme-bg-hover)]" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2">
          {/* Issues - amber */}
          <BadgeIcon
            color="text-amber-400"
            dimColor="text-[var(--theme-text-faint)]"
            count={summary.openIssuesCount}
            icon={<CircleDotIcon />}
            title="Open issues"
          />
          {/* My PRs - coral */}
          <BadgeIcon
            color="text-[var(--theme-accent)]"
            dimColor="text-[var(--theme-text-faint)]"
            count={summary.myPRsCount}
            icon={<GitPullRequestArrowIcon />}
            title="My PRs"
          />
          {/* Assigned PRs - blue */}
          <BadgeIcon
            color="text-blue-400"
            dimColor="text-[var(--theme-text-faint)]"
            count={summary.assignedPRsCount}
            icon={<UserCheckIcon />}
            title="Assigned to me"
          />
          {/* All open PRs - zinc */}
          <BadgeIcon
            color="text-[var(--theme-text-secondary)]"
            dimColor="text-[var(--theme-text-faint)]"
            count={summary.openPRsCount}
            icon={<GitPullRequestIcon />}
            title="Open PRs"
          />
          {/* Merged 7d - emerald */}
          <BadgeIcon
            color="text-emerald-400"
            dimColor="text-[var(--theme-text-faint)]"
            count={summary.recentlyMergedPRsCount}
            icon={<GitMergeIcon />}
            title="Merged (7d)"
          />
        </div>
      )}
    </button>
  );
}

function BadgeIcon({
  color,
  dimColor,
  count,
  icon,
  title,
}: {
  color: string;
  dimColor: string;
  count: number;
  icon: React.ReactNode;
  title: string;
}) {
  const isDim = count === 0;
  return (
    <span className={cn('flex items-center gap-0.5', isDim ? dimColor : color)} title={title}>
      {icon}
      <span className="text-[10px]">{count}</span>
    </span>
  );
}

function CircleDotIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

function GitPullRequestArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="11" cy="12.5" r="1.5" />
      <line x1="5" y1="5" x2="5" y2="14" />
      <line x1="11" y1="11" x2="11" y2="6" />
      <polyline points="8.5,8 11,5.5 13.5,8" />
    </svg>
  );
}

function UserCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M2 14c0-2.5 2-4 4-4s4 1.5 4 4" />
      <polyline points="11,8 12.5,9.5 15,7" />
    </svg>
  );
}

function GitPullRequestIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="12.5" r="1.5" />
      <line x1="5" y1="5" x2="5" y2="11" />
      <line x1="11" y1="5" x2="11" y2="11" />
    </svg>
  );
}

function GitMergeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <line x1="5" y1="5" x2="5" y2="11" />
      <path d="M5 7c2 0 4 1 6 4" />
    </svg>
  );
}
