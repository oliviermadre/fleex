import { useState, useCallback, useMemo, useRef } from 'react';
import type { Session } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SessionItem } from './SessionItem';
import { PlusIcon, TerminalIcon } from './icons';
import { HotkeyBadge } from '../ui/HotkeyBadge';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';

const SYSTEM_GROUP_ID = '_system';
const SYSTEM_BG = 'rgba(255, 255, 255, 0.03)';

interface Props {
  sessions: Session[];
}

export function SystemGroup({ sessions }: Props) {
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const collapsed = collapsedGroups.has(SYSTEM_GROUP_ID);

  const addSession = useSessionStore((s) => s.addSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const basePath = useSettingsStore((s) => s.settings.basePath);

  const sessOrder = useSettingsStore((s) => s.settings.sessionOrder[SYSTEM_GROUP_ID]);
  const setSessionOrder = useSettingsStore((s) => s.setSessionOrder);

  const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedSessionIdRef = useRef<string | null>(null);

  const sortedSessions: readonly Session[] = useMemo(() => {
    if (!sessOrder || sessOrder.length === 0) return sessions;
    const orderMap = new Map(sessOrder.map((id, i) => [id, i]));
    return [...sessions].sort((a, b) => {
      const aOrder = orderMap.get(a.id) ?? Infinity;
      const bOrder = orderMap.get(b.id) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [sessions, sessOrder]);

  const handleSessionDragStart = useCallback((sessionId: string) => (e: React.DragEvent) => {
    e.stopPropagation();
    draggedSessionIdRef.current = sessionId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-session', `${SYSTEM_GROUP_ID}:${sessionId}`);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

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
    if (sourceGroup !== SYSTEM_GROUP_ID || sourceSessionId === targetSessionId) return;

    const sessionIds = sortedSessions.map((s) => s.id);
    const fromIdx = sessionIds.indexOf(sourceSessionId);
    if (fromIdx === -1) return;

    sessionIds.splice(fromIdx, 1);
    let toIdx = sessionIds.indexOf(targetSessionId);
    if (toIdx === -1) return;
    if (dropEdge === 'bottom') toIdx += 1;
    sessionIds.splice(toIdx, 0, sourceSessionId);

    setSessionOrder(SYSTEM_GROUP_ID, sessionIds);
  }, [sortedSessions, dropEdge, setSessionOrder]);

  const handleAddShell = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const cwd = basePath || '~';
    try {
      const session = await api.createSession({ cwd, type: 'shell' });
      addSession(session);
      selectSession(session.id);
      const groups = await api.fetchSessionGroups();
      setSessionGroups(groups);
    } catch {
      // silently fail
    }
  };

  return (
    <div
      className="mx-1.5 my-1 rounded-lg"
      style={{ backgroundColor: SYSTEM_BG }}
    >
      <div className="flex w-full items-center gap-1.5 px-3 py-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:opacity-80"
          onClick={() => toggleGroup(SYSTEM_GROUP_ID)}
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
          <TerminalIcon size={14} className="shrink-0 text-[var(--theme-text-secondary)]" />
          <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
            System
          </span>
          <span className="ml-1 shrink-0 text-[10px] text-[var(--theme-text-faint)]">
            {sessions.length}
          </span>
        </button>
        <button
          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          onClick={handleAddShell}
          title="New system shell (⌥T)"
        >
          <PlusIcon size={14} />
          <HotkeyBadge hotkey="⌥T" position="top-right" />
        </button>
      </div>
      {!collapsed && (
        <div className="ml-3">
          {sortedSessions.length === 0 ? (
            <div className="px-3 pb-2 text-[11px] text-[var(--theme-text-faint)]">
              No sessions
            </div>
          ) : (
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
                    <div className="absolute left-5 right-2 top-0 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
                  )}
                  <SessionItem session={session} />
                  {isOver && dropEdge === 'bottom' && (
                    <div className="absolute bottom-0 left-5 right-2 z-10 h-0.5 rounded bg-[var(--theme-accent)]" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export { SYSTEM_GROUP_ID };
