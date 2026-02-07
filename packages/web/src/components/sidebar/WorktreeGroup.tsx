import { useState, useCallback, useMemo, useRef } from 'react';
import type { WorktreeSessionGroup, Session } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SessionItem } from './SessionItem';
import { GitForkIcon, PlusIcon } from './icons';
import { WorktreeActionsBar } from './WorktreeActionsBar';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';

interface Props {
  worktree: WorktreeSessionGroup;
  repoGroupId: string;
  repositoryOrg: string;
  repositoryName: string;
}

export function WorktreeGroup({ worktree, repoGroupId, repositoryOrg, repositoryName }: Props) {
  const groupId = `${repoGroupId}:${worktree.branch}`;
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const addSession = useSessionStore((s) => s.addSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const collapsed = collapsedGroups.has(groupId);

  const sessOrder = useSettingsStore((s) => s.settings.sessionOrder[groupId]);
  const setSessionOrder = useSettingsStore((s) => s.setSessionOrder);

  const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedSessionIdRef = useRef<string | null>(null);

  const sortedSessions: readonly Session[] = useMemo(() => {
    if (!sessOrder || sessOrder.length === 0) return worktree.sessions;
    const orderMap = new Map(sessOrder.map((id, i) => [id, i]));
    return [...worktree.sessions].sort((a, b) => {
      const aOrder = orderMap.get(a.id) ?? Infinity;
      const bOrder = orderMap.get(b.id) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [worktree.sessions, sessOrder]);

  const handleSessionDragStart = useCallback((sessionId: string) => (e: React.DragEvent) => {
    e.stopPropagation();
    draggedSessionIdRef.current = sessionId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-session', `${groupId}:${sessionId}`);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, [groupId]);

  const handleSessionDragEnd = useCallback((e: React.DragEvent) => {
    draggedSessionIdRef.current = null;
    setDragOverSessionId(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleSessionDragOver = useCallback((sessionId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-session')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropEdge(e.clientY < midY ? 'top' : 'bottom');
    setDragOverSessionId(sessionId);
  }, []);

  const handleSessionDragLeave = useCallback((sessionId: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverSessionId === sessionId) setDragOverSessionId(null);
  }, [dragOverSessionId]);

  const handleSessionDrop = useCallback((targetSessionId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const data = e.dataTransfer.getData('application/x-session');
    setDragOverSessionId(null);
    if (!data) return;

    const lastColon = data.lastIndexOf(':');
    const sourceGroup = data.substring(0, lastColon);
    const sourceSessionId = data.substring(lastColon + 1);
    if (sourceGroup !== groupId || sourceSessionId === targetSessionId) return;

    const sessionIds = sortedSessions.map((s) => s.id);
    const fromIdx = sessionIds.indexOf(sourceSessionId);
    if (fromIdx === -1) return;

    sessionIds.splice(fromIdx, 1);
    let toIdx = sessionIds.indexOf(targetSessionId);
    if (toIdx === -1) return;
    if (dropEdge === 'bottom') toIdx += 1;
    sessionIds.splice(toIdx, 0, sourceSessionId);

    setSessionOrder(groupId, sessionIds);
  }, [groupId, sortedSessions, dropEdge, setSessionOrder]);

  const handleAddShell = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const session = await api.createSession({ cwd: worktree.path, type: 'shell' });
      addSession(session);
      selectSession(session.id);
      const groups = await api.fetchSessionGroups();
      setSessionGroups(groups);
    } catch {
      // silently fail
    }
  };

  return (
    <div className="ml-3">
      <div className="group/wt relative flex items-center">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left hover:bg-zinc-800/30"
          onClick={() => toggleGroup(groupId)}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={cn(
              'shrink-0 text-zinc-600 transition-transform',
              collapsed ? 'rotate-0' : 'rotate-90'
            )}
          >
            <path d="M3 1l5 4-5 4V1z" />
          </svg>
          <GitForkIcon size={12} className="shrink-0 text-zinc-500" />
          <span className="truncate text-xs text-zinc-400">{worktree.branch}</span>
          <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{worktree.sessions.length}</span>
        </button>
        <button
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300"
          onClick={handleAddShell}
          title="New shell in this worktree"
        >
          <PlusIcon size={12} />
        </button>
        <WorktreeActionsBar
          repositoryOrg={repositoryOrg}
          repositoryName={repositoryName}
          branch={worktree.branch}
          worktreePath={worktree.path}
        />
      </div>
      {!collapsed &&
        sortedSessions.map((session: Session) => {
          const isOver = dragOverSessionId === session.id && draggedSessionIdRef.current !== session.id;
          return (
            <div
              key={session.id}
              draggable
              onDragStart={handleSessionDragStart(session.id)}
              onDragEnd={handleSessionDragEnd}
              onDragOver={handleSessionDragOver(session.id)}
              onDragLeave={handleSessionDragLeave(session.id)}
              onDrop={handleSessionDrop(session.id)}
              className="relative"
            >
              {isOver && dropEdge === 'top' && (
                <div className="absolute left-5 right-2 top-0 z-10 h-0.5 rounded bg-[#D77655]" />
              )}
              <SessionItem session={session} />
              {isOver && dropEdge === 'bottom' && (
                <div className="absolute bottom-0 left-5 right-2 z-10 h-0.5 rounded bg-[#D77655]" />
              )}
            </div>
          );
        })}
    </div>
  );
}
