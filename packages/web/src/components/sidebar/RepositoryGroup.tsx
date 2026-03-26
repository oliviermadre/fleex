import { useState, useCallback, useMemo, useRef } from 'react';
import type { SessionGroup, WorktreeSessionGroup } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { WorktreeGroup } from './WorktreeGroup';
import { GitHubIcon } from './icons';
import { cn } from '../../lib/cn';

export type FlowType = 'manual' | 'agentic';

interface Props {
  group: SessionGroup;
  flowType?: FlowType;
}

export function RepositoryGroup({ group, flowType }: Props) {
  const groupId = `${group.repositoryOrg}/${group.repositoryName}`;
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const openScratchpadForRepo = useUIStore((s) => s.openScratchpadForRepo);
  const collapsed = collapsedGroups.has(groupId);

  const wtOrder = useSettingsStore((s) => s.settings.worktreeOrder[groupId]);
  const setWorktreeOrder = useSettingsStore((s) => s.setWorktreeOrder);

  const [dragOverBranch, setDragOverBranch] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedBranchRef = useRef<string | null>(null);

  const sortedWorktrees: readonly WorktreeSessionGroup[] = useMemo(() => {
    if (!wtOrder || wtOrder.length === 0) return [...group.worktrees].sort((a, b) => a.branch.toLowerCase().localeCompare(b.branch.toLowerCase()));
    const orderMap = new Map(wtOrder.map((id, i) => [id, i]));
    return [...group.worktrees].sort((a, b) => {
      const aOrder = orderMap.get(a.branch) ?? Infinity;
      const bOrder = orderMap.get(b.branch) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [group.worktrees, wtOrder]);

  const handleWtDragStart = useCallback((branch: string) => (e: React.DragEvent) => {
    e.stopPropagation();
    draggedBranchRef.current = branch;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-worktree', `${groupId}:${branch}`);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, [groupId]);

  const handleWtDragEnd = useCallback((e: React.DragEvent) => {
    draggedBranchRef.current = null;
    setDragOverBranch(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleWtDragOver = useCallback((branch: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-worktree')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropEdge(e.clientY < midY ? 'top' : 'bottom');
    setDragOverBranch(branch);
  }, []);

  const handleWtDragLeave = useCallback((branch: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverBranch === branch) setDragOverBranch(null);
  }, [dragOverBranch]);

  const handleWtDrop = useCallback((targetBranch: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const data = e.dataTransfer.getData('application/x-worktree');
    setDragOverBranch(null);
    if (!data) return;

    const [sourceRepo, sourceBranch] = [
      data.substring(0, data.lastIndexOf(':')),
      data.substring(data.lastIndexOf(':') + 1),
    ];
    if (sourceRepo !== groupId || sourceBranch === targetBranch) return;

    const branches = sortedWorktrees.map((wt) => wt.branch);
    const fromIdx = branches.indexOf(sourceBranch);
    if (fromIdx === -1) return;

    branches.splice(fromIdx, 1);
    let toIdx = branches.indexOf(targetBranch);
    if (toIdx === -1) return;
    if (dropEdge === 'bottom') toIdx += 1;
    branches.splice(toIdx, 0, sourceBranch);

    setWorktreeOrder(groupId, branches);
  }, [groupId, sortedWorktrees, dropEdge, setWorktreeOrder]);

  return (
    <div className="my-1.5">
      <button
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-[var(--theme-bg-hover)]"
        onClick={() => toggleGroup(groupId)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-[var(--theme-text-muted)] transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90'
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          {group.repositoryOrg}/{group.repositoryName}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span
            role="button"
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] p-0.5 rounded hover:bg-white/[0.08] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              openScratchpadForRepo(groupId);
            }}
            title="Open scratchpad"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7a1.5 1.5 0 01-1.5 1.5H5l-3 2.5V3.5z" />
            </svg>
          </span>
          <a
            href={`https://github.com/${group.repositoryOrg}/${group.repositoryName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
            onClick={(e) => e.stopPropagation()}
          >
            <GitHubIcon size={14} />
          </a>
        </span>
      </button>
      {!collapsed &&
        sortedWorktrees.map((wt) => {
          const isOver = dragOverBranch === wt.branch && draggedBranchRef.current !== wt.branch;
          return (
            <div
              key={wt.branch}
              draggable
              onDragStart={handleWtDragStart(wt.branch)}
              onDragEnd={handleWtDragEnd}
              onDragOver={handleWtDragOver(wt.branch)}
              onDragLeave={handleWtDragLeave(wt.branch)}
              onDrop={handleWtDrop(wt.branch)}
              className="relative"
            >
              {isOver && dropEdge === 'top' && (
                <div className="absolute left-4 right-2 top-0 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
              )}
              <WorktreeGroup
                worktree={wt}
                repoGroupId={groupId}
                repositoryOrg={group.repositoryOrg}
                repositoryName={group.repositoryName}
                flowType={flowType}
              />
              {isOver && dropEdge === 'bottom' && (
                <div className="absolute bottom-0 left-4 right-2 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
              )}
            </div>
          );
        })}
    </div>
  );
}
