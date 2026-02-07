import { useState, useCallback, useMemo, useRef } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { RepositoryGroup } from './RepositoryGroup';

export function SessionGroups() {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const setRepoOrder = useSettingsStore((s) => s.setRepoOrder);

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
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-zinc-500">No sessions</p>
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
              <div className="absolute left-2 right-2 top-0 z-10 h-0.5 rounded bg-violet-500" />
            )}
            <RepositoryGroup group={group} />
            {isOver && dropEdge === 'bottom' && (
              <div className="absolute bottom-0 left-2 right-2 z-10 h-0.5 rounded bg-violet-500" />
            )}
          </div>
        );
      })}
    </div>
  );
}
