import type { Session } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { deriveDisplayStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../services/api';
import { HotkeyBadge } from '../ui/HotkeyBadge';

interface Props {
  session: Session;
  splitFocused?: boolean;
}

export function SessionHeader({ session, splitFocused }: Props) {
  const floatingSessionId = useUIStore((s) => s.floatingSessionId);
  const setFloatingSession = useUIStore((s) => s.setFloatingSession);
  const isFloating = floatingSessionId === session.id;

  const repoKey = session.repositoryOrg && session.repositoryName
    ? `${session.repositoryOrg}/${session.repositoryName}`
    : null;
  const pr = usePullRequestStore((s) =>
    repoKey && session.worktreeBranch
      ? s.pullsByRepo[repoKey]?.[session.worktreeBranch]
      : undefined
  );

  const status = useMemo(() => deriveDisplayStatus(session), [session]);

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-3',
        splitFocused
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
          : 'border-[var(--theme-border)]'
      )}
      style={{ height: 'var(--header-height)' }}
    >
      {/* Branch icon + branch name */}
      <div className="flex items-center gap-1.5 min-w-0">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-secondary)]">
          <circle cx="5" cy="3.5" r="1.5" />
          <circle cx="5" cy="12.5" r="1.5" />
          <circle cx="12" cy="7" r="1.5" />
          <path d="M5 5v6M5 7.5c0-1.5 1-3 4.5-3" />
        </svg>
        <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
          {session.worktreeBranch || session.tmuxName}
        </span>
      </div>

      {/* Status dot + label */}
      <div className="flex items-center gap-1.5 shrink-0">
        <StatusDot status={status.status} size="sm" />
        <span className={`text-[10px] ${status.textColor}`}>{status.label}</span>
        {status.warning && (
          <span className="text-[10px] text-amber-400">&#9888;</span>
        )}
      </div>

      {/* PR badge */}
      {pr && (
        <a
          href={`https://github.com/${session.repositoryOrg}/${session.repositoryName}/pull/${pr.number}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
            pr.state === 'merged'
              ? 'bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white'
              : 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)] hover:bg-[var(--theme-accent)] hover:text-white'
          )}
          title={pr.title}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" /></svg>
          #{pr.number}
        </a>
      )}

      {/* Worktree path */}
      <span className="shrink-0 truncate text-xs text-[var(--theme-text-faint)] max-w-[40%]" title={session.cwd}>
        {session.cwd}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {/* Floating toggle */}
        <button
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors border-none',
            isFloating
              ? 'text-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
              : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-accent)] bg-transparent hover:bg-[var(--theme-bg-hover)]'
          )}
          onClick={() => setFloatingSession(isFloating ? null : session.id)}
          title={isFloating ? 'Re-attach to main panel' : 'Detach to floating overlay'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="9" height="9" rx="1.5" />
            <path d="M13 7V3h-4" />
            <line x1="13" y1="3" x2="7" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** Tab bar for sibling sessions within the same worktree */
export function SessionTabs({ currentSession }: { currentSession: Session }) {
  const navigate = useNavigate();
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const addSessionToGroup = useSessionStore((s) => s.addSessionToGroup);
  const selectSession = useSessionStore((s) => s.selectSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);

  // Build the worktree group key: "org/name:branch" (or "_system" for system shells)
  const isSystemSession = !currentSession.repositoryOrg || !currentSession.repositoryName || !currentSession.worktreeBranch;
  const groupId = isSystemSession
    ? '_system'
    : `${currentSession.repositoryOrg}/${currentSession.repositoryName}:${currentSession.worktreeBranch}`;

  const sessOrder = useSettingsStore((s) => s.settings.sessionOrder[groupId]);
  const setSessionOrder = useSettingsStore((s) => s.setSessionOrder);

  const worktreeData = useMemo(() => {
    const targetOrg = currentSession.repositoryOrg ?? '_ungrouped';
    const targetName = currentSession.repositoryName ?? '_ungrouped';
    const targetBranch = currentSession.worktreeBranch ?? '_default';
    for (const group of sessionGroups) {
      if (group.repositoryOrg === targetOrg && group.repositoryName === targetName) {
        for (const wt of group.worktrees) {
          if (wt.branch === targetBranch) {
            return wt;
          }
        }
      }
    }
    return null;
  }, [sessionGroups, currentSession.repositoryOrg, currentSession.repositoryName, currentSession.worktreeBranch]);

  // Sort sessions using the persisted order (falls back to createdAt)
  const sortedSessions: readonly Session[] = useMemo(() => {
    if (!worktreeData) return [];
    if (!sessOrder || sessOrder.length === 0) {
      return [...worktreeData.sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    const orderMap = new Map(sessOrder.map((id, i) => [id, i]));
    return [...worktreeData.sessions].sort((a, b) => {
      const aOrder = orderMap.get(a.id) ?? Infinity;
      const bOrder = orderMap.get(b.id) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [worktreeData, sessOrder]);

  // Drag-to-reorder state
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'left' | 'right'>('right');
  const draggedIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((sessionId: string) => (e: React.DragEvent) => {
    draggedIdRef.current = sessionId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-session-tab', sessionId);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    draggedIdRef.current = null;
    setDragOverId(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleDragOver = useCallback((sessionId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-session-tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    setDropEdge(e.clientX < midX ? 'left' : 'right');
    setDragOverId(sessionId);
  }, []);

  const handleDragLeave = useCallback((sessionId: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverId === sessionId) setDragOverId(null);
  }, [dragOverId]);

  const handleDrop = useCallback((targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('application/x-session-tab');
    setDragOverId(null);
    if (!sourceId || sourceId === targetId || !groupId) return;

    const ids = sortedSessions.map((s) => s.id);
    const fromIdx = ids.indexOf(sourceId);
    if (fromIdx === -1) return;

    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(targetId);
    if (toIdx === -1) return;
    if (dropEdge === 'right') toIdx += 1;
    ids.splice(toIdx, 0, sourceId);

    setSessionOrder(groupId, ids);
  }, [sortedSessions, dropEdge, groupId, setSessionOrder]);

  const handleCloseTab = useCallback(async (sessionId: string) => {
    try {
      await api.killSession(sessionId);
      removeSession(sessionId);
      // If we just closed the active tab, navigate to a sibling
      if (sessionId === currentSession.id) {
        const remaining = sortedSessions.filter((s) => s.id !== sessionId);
        if (remaining.length > 0) {
          navigate(`/sessions/${remaining[0]!.id}`, { replace: true });
        } else {
          navigate('/sessions', { replace: true });
        }
      }
    } catch {
      // silently fail
    }
  }, [currentSession.id, sortedSessions, removeSession, navigate]);

  const basePath = useSettingsStore((s) => s.settings.basePath);

  const handleNewTab = useCallback(async () => {
    const cwd = worktreeData?.path || basePath || '~';
    try {
      const session = await api.createSession({ cwd, type: 'shell' });
      // Optimistically add to both sessions and sessionGroups, then select.
      // This avoids the flash where a WS broadcast could overwrite the sessions
      // array before fetchSessionGroups completes.
      addSessionToGroup(session);
      selectSession(session.id);
      // Refresh groups in background for eventual consistency (non-blocking)
      api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
    } catch {
      // silently fail
    }
  }, [worktreeData, basePath, addSessionToGroup, selectSession, setSessionGroups]);

  // Listen for Cmd+N "new tab" event
  useEffect(() => {
    const handler = () => { handleNewTab(); };
    window.addEventListener('asm:new-tab', handler);
    return () => window.removeEventListener('asm:new-tab', handler);
  }, [handleNewTab]);

  if (sortedSessions.length === 0) return null;

  return (
    <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 overflow-x-auto">
      {sortedSessions.map((s) => {
        const isOver = dragOverId === s.id && draggedIdRef.current !== s.id;
        return (
          <div
            key={s.id}
            draggable
            onDragStart={handleDragStart(s.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver(s.id)}
            onDragLeave={handleDragLeave(s.id)}
            onDrop={handleDrop(s.id)}
            className="relative"
          >
            {isOver && dropEdge === 'left' && (
              <div className="absolute left-0 top-1 bottom-1 z-10 w-0.5 rounded bg-[var(--theme-accent)]" />
            )}
            <SessionTab
              session={s}
              isActive={s.id === currentSession.id}
              onClose={handleCloseTab}
            />
            {isOver && dropEdge === 'right' && (
              <div className="absolute right-0 top-1 bottom-1 z-10 w-0.5 rounded bg-[var(--theme-accent)]" />
            )}
          </div>
        );
      })}
      {/* New Tab button */}
      <button
        className="relative flex items-center gap-1 px-3 py-2 text-xs whitespace-nowrap text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
        onClick={handleNewTab}
        title="New shell in this worktree"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
        <span>New Tab</span>
        <HotkeyBadge hotkey="⌘N" position="top-right" />
      </button>
    </div>
  );
}

/** Individual tab with inline rename (double-click) and close button (hover) */
function SessionTab({ session, isActive, onClose }: { session: Session; isActive: boolean; onClose: (id: string) => void }) {
  const navigate = useNavigate();
  const setSessions = useSessionStore((s) => s.setSessions);
  const sessions = useSessionStore((s) => s.sessions);
  const status = useMemo(() => deriveDisplayStatus(session), [session]);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayLabel = session.displayName || session.tmuxName || session.id.slice(0, 8);

  const startEditing = useCallback(() => {
    setEditValue(displayLabel);
    setEditing(true);
  }, [displayLabel]);

  const commitRename = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === displayLabel) return;
    try {
      const updated = await api.renameSession(session.id, trimmed);
      setSessions(sessions.map((s) => s.id === updated.id ? updated : s));
    } catch {
      // silently fail
    }
  }, [editValue, displayLabel, session.id, sessions, setSessions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }, [commitRename]);

  // Auto-focus input when entering edit mode
  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  return (
    <div
      className={cn(
        'group/tab relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-colors',
        isActive
          ? 'text-[var(--theme-text-primary)]'
          : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
      )}
      role="button"
      onClick={() => { if (!editing) navigate(`/sessions/${session.id}`, { replace: true }); }}
      onDoubleClick={(e) => { e.stopPropagation(); startEditing(); }}
    >
      {/* Session type icon */}
      {session.type === 'shell' ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M4 5l3 3-3 3" />
          <line x1="9" y1="11" x2="12" y2="11" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      )}

      {/* Label or inline input */}
      {editing ? (
        <input
          ref={setInputRef}
          className="w-[100px] bg-transparent text-xs text-[var(--theme-text-primary)] outline-none border-b border-[var(--theme-accent)]"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate max-w-[120px]">{displayLabel}</span>
      )}

      {/* Fixed-size slot: activity dot (default) / close button (hover) */}
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <StatusDot status={status.status} size="sm" className="group-hover/tab:hidden" />
        <button
          className="hidden items-center justify-center rounded text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)] group-hover/tab:flex absolute inset-0"
          onClick={(e) => { e.stopPropagation(); onClose(session.id); }}
          title="Close session"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </span>

      {/* Active indicator */}
      {isActive && (
        <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
      )}
    </div>
  );
}
