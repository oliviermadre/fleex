import { useState, useCallback, useMemo, useRef } from 'react';
import type { Session } from '@asm/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { RepositoryGroup } from './RepositoryGroup';
import { SystemGroup } from './SystemGroup';
import { PlusIcon } from './icons';
import { HotkeyBadge } from '../ui/HotkeyBadge';

function isSystemGroup(org: string, name: string): boolean {
  return org === '_ungrouped' && name === '_ungrouped';
}

export function SessionGroups() {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const setRepoOrder = useSettingsStore((s) => s.setRepoOrder);
  const openCreateModal = useUIStore((s) => s.openCreateModal);

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedIdRef = useRef<string | null>(null);

  // Extract system sessions (ungrouped) and repo groups separately
  const systemSessions: Session[] = useMemo(() => {
    const ungrouped = sessionGroups.find((g) =>
      isSystemGroup(g.repositoryOrg, g.repositoryName)
    );
    if (!ungrouped) return [];
    return ungrouped.worktrees.flatMap((wt) => wt.sessions);
  }, [sessionGroups]);

  const repoGroups = useMemo(() => {
    return sessionGroups.filter(
      (g) => !isSystemGroup(g.repositoryOrg, g.repositoryName)
    );
  }, [sessionGroups]);

  const sortedGroups = useMemo(() => {
    if (repoOrder.length === 0) return repoGroups;
    const orderMap = new Map(repoOrder.map((id, i) => [id, i]));
    return [...repoGroups].sort((a, b) => {
      const aId = `${a.repositoryOrg}/${a.repositoryName}`;
      const bId = `${b.repositoryOrg}/${b.repositoryName}`;
      const aOrder = orderMap.get(aId) ?? Infinity;
      const bOrder = orderMap.get(bId) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [repoGroups, repoOrder]);

  const handleDragStart = useCallback((groupId: string) => (e: React.DragEvent) => {
    draggedIdRef.current = groupId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-repo-group', groupId);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    draggedIdRef.current = null;
    setDragOverId(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleDragOver = useCallback((groupId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-repo-group')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropEdge(e.clientY < midY ? 'top' : 'bottom');
    setDragOverId(groupId);
  }, []);

  const handleDragLeave = useCallback((groupId: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverId === groupId) setDragOverId(null);
  }, [dragOverId]);

  const handleDrop = useCallback((targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('application/x-repo-group');
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;

    const ids = sortedGroups.map((g) => `${g.repositoryOrg}/${g.repositoryName}`);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx === -1) return;

    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(targetId);
    if (toIdx === -1) return;
    if (dropEdge === 'bottom') toIdx += 1;
    ids.splice(toIdx, 0, draggedId);

    setRepoOrder(ids);
  }, [sortedGroups, dropEdge, setRepoOrder]);

  return (
    <div className="flex-1 overflow-y-auto">
      <SystemGroup sessions={systemSessions} />
      {sortedGroups.map((group) => {
        const groupId = `${group.repositoryOrg}/${group.repositoryName}`;
        const isOver = dragOverId === groupId && draggedIdRef.current !== groupId;
        return (
          <div
            key={groupId}
            draggable
            onDragStart={handleDragStart(groupId)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver(groupId)}
            onDragLeave={handleDragLeave(groupId)}
            onDrop={handleDrop(groupId)}
            className="relative"
          >
            {isOver && dropEdge === 'top' && (
              <div className="absolute left-1.5 right-1.5 top-0 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
            <RepositoryGroup group={group} />
            {isOver && dropEdge === 'bottom' && (
              <div className="absolute bottom-0 left-1.5 right-1.5 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
          </div>
        );
      })}
      {sortedGroups.length > 0 && (
        <button
          className="relative mx-1.5 mt-3 mb-1 flex w-[calc(100%-12px)] cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white bg-[var(--theme-accent-muted)] transition-all hover:bg-[var(--theme-accent)] hover:shadow-[0_0_12px_var(--theme-accent-muted)]"
          onClick={openCreateModal}
        >
          <PlusIcon size={16} />
          New Session
          <HotkeyBadge hotkey="⌥⌘N" position="top-right" />
        </button>
      )}
    </div>
  );
}
