import { useState, useCallback, useMemo, useRef } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { RepositoryGroup } from './RepositoryGroup';
import { PlusIcon } from './icons';

export function SessionGroups() {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const setRepoOrder = useSettingsStore((s) => s.setRepoOrder);
  const openCreateModal = useUIStore((s) => s.openCreateModal);

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedIdRef = useRef<string | null>(null);

  const sortedGroups = useMemo(() => {
    if (repoOrder.length === 0) return sessionGroups;
    const orderMap = new Map(repoOrder.map((id, i) => [id, i]));
    return [...sessionGroups].sort((a, b) => {
      const aId = `${a.repositoryOrg}/${a.repositoryName}`;
      const bId = `${b.repositoryOrg}/${b.repositoryName}`;
      const aOrder = orderMap.get(aId) ?? Infinity;
      const bOrder = orderMap.get(bId) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [sessionGroups, repoOrder]);

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

  if (sessionGroups.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-xs text-zinc-500">No sessions</p>
        </div>
        <button
          className="flex items-center justify-center gap-2 border-t border-zinc-800/50 px-4 py-2.5 text-sm font-medium text-white bg-[#D77655]/10 rounded-lg transition-all hover:bg-[#D77655] hover:shadow-[0_0_12px_rgba(215,118,85,0.5)]"
          onClick={openCreateModal}
        >
          <PlusIcon size={16} />
          New Session
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
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
              <div className="absolute left-1.5 right-1.5 top-0 z-10 h-0.5 rounded bg-[#D77655]" />
            )}
            <RepositoryGroup group={group} />
            {isOver && dropEdge === 'bottom' && (
              <div className="absolute bottom-0 left-1.5 right-1.5 z-10 h-0.5 rounded bg-[#D77655]" />
            )}
          </div>
        );
      })}
      <button
        className="mx-1.5 mt-3 mb-1 flex w-[calc(100%-12px)] items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white bg-[#D77655]/10 transition-all hover:bg-[#D77655] hover:shadow-[0_0_12px_rgba(215,118,85,0.5)]"
        onClick={openCreateModal}
      >
        <PlusIcon size={16} />
        New Session
      </button>
    </div>
  );
}
