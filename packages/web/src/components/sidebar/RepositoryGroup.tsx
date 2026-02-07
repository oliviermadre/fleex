import { useState, useCallback, useMemo, useRef } from 'react';
import type { SessionGroup } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
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

  const wtOrder = useSettingsStore((s) => s.settings.worktreeOrder[groupId]);
  const setWorktreeOrder = useSettingsStore((s) => s.setWorktreeOrder);

  const [dragOverBranch, setDragOverBranch] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedBranchRef = useRef<string | null>(null);

  const sortedWorktrees = useMemo(() => {
    if (!wtOrder || wtOrder.length === 0) return group.worktrees;
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
                <div className="absolute left-5 right-2 top-0 z-10 h-0.5 rounded bg-violet-500" />
              )}
              <WorktreeGroup
                worktree={wt}
                repoGroupId={groupId}
              />
              {isOver && dropEdge === 'bottom' && (
                <div className="absolute bottom-0 left-5 right-2 z-10 h-0.5 rounded bg-violet-500" />
              )}
            </div>
          );
        })}
    </div>
  );
}
