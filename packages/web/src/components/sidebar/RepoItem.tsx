import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import type { RepositorySummary } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tintText, tintClasses } from '../../lib/tints';
import { useUIStore } from '../../stores/uiStore';
import { TrashIcon } from '../ui/TrashIcon';

import { GitHubIcon } from './icons';

interface Props {
  summary: RepositorySummary;
  onRemove: (key: string) => void;
}

export function RepoItem({ summary, onRemove }: Props) {
  const navigate = useNavigate();
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const openScratchpadForRepo = useUIStore((s) => s.openScratchpadForRepo);
  const key = `${summary.org}/${summary.name}`;
  const isSelected = selectedRepoKey === key;

  const handleScratchpadClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      openScratchpadForRepo(key);
    },
    [openScratchpadForRepo, key],
  );

  const handleRemoveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove(key);
    },
    [onRemove, key],
  );

  return (
    <button
      className={cn(
        'group flex min-w-0 w-full items-center py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
        isSelected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
      onClick={() => navigate(`/repositories/${key}`, { replace: true })}
    >
      <span
        className={cn(
          'flex-shrink-0',
          isSelected ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]',
        )}
      >
        <GitBranchIcon />
      </span>
      <div className="ml-1.5 flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
          {summary.name}
        </span>
        <span className="truncate font-mono text-[11px] text-[var(--theme-text-muted)]">{key}</span>
      </div>
      <div className="ml-auto flex flex-shrink-0 items-center gap-1 pl-2">
        {summary.isClonedLocally === false && (
          <span className={cn('flex-shrink-0', tintText('yellow'))} title="Not cloned locally">
            <CloudDownloadIcon />
          </span>
        )}
        <a
          href={`https://github.com/${key}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.08]"
          onClick={(e) => e.stopPropagation()}
          title="Open on GitHub"
        >
          <GitHubIcon size={12} />
        </a>
        <span
          role="button"
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.08]"
          onClick={handleScratchpadClick}
          title="Open scratchpad"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7a1.5 1.5 0 01-1.5 1.5H5l-3 2.5V3.5z" />
          </svg>
        </span>
        <span
          role="button"
          className={cn(
            'ml-1 hidden flex-shrink-0 items-center justify-center rounded p-0.5 text-[var(--theme-text-faint)] transition-colors group-hover:flex',
            tintClasses('red').hoverText,
          )}
          title="Stop tracking this repo"
          onClick={handleRemoveClick}
        >
          <TrashIcon />
        </span>
      </div>
    </button>
  );
}

function GitBranchIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <line x1="4" y1="5.5" x2="4" y2="10.5" />
      <path d="M4 5.5a4 4 0 004 4h2.5" />
    </svg>
  );
}

function CloudDownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 12.5h-1A2.5 2.5 0 011 10a2.5 2.5 0 012.2-2.5 4 4 0 017.6 0A2.5 2.5 0 0113 10a2.5 2.5 0 01-2.5 2.5h-1" />
      <line x1="8" y1="8" x2="8" y2="14" />
      <polyline points="6,12 8,14 10,12" />
    </svg>
  );
}
