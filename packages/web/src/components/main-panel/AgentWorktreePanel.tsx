import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { Session, AgentExecution, WorktreeSessionGroup } from '@fleex/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useTerminal } from '../../hooks/useTerminal';
import { terminalManager } from '../../services/terminalManager';
import { AgentEventStream } from './AgentEventStream';
import { TopToolbar } from './TopToolbar';
import { StatusDot } from '../ui/StatusDot';
import { deriveDisplayStatus } from '../../lib/deriveStatus';
import { cn } from '../../lib/cn';
import { HotkeyBadge } from '../ui/HotkeyBadge';
import * as api from '../../services/api';

const EMPTY_EXECUTIONS: AgentExecution[] = [];

type ActiveTab =
  | { kind: 'execution'; executionId: string }
  | { kind: 'session'; sessionId: string };

/** Unique key for a tab — used for ordering and drag-to-reorder */
function tabKey(tab: ActiveTab): string {
  return tab.kind === 'session' ? `s:${tab.sessionId}` : `e:${tab.executionId}`;
}

function tabsMatch(a: ActiveTab, b: ActiveTab): boolean {
  return tabKey(a) === tabKey(b);
}

interface Props {
  ticketId: string;
}

export function AgentWorktreePanel({ ticketId }: Props) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticketId] ?? EMPTY_EXECUTIONS);
  const loadExecutions = useAgentEventStore((s) => s.loadExecutionsForTicket);

  // Find the worktree + parent repo group that owns this agent ticket
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const addSessionToGroup = useSessionStore((s) => s.addSessionToGroup);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const basePath = useSettingsStore((s) => s.settings.basePath);

  const { worktreeData, repoOrg, repoName } = useMemo(() => {
    for (const group of sessionGroups) {
      for (const wt of group.worktrees) {
        if (wt.agentWorktree?.ticketId === ticketId)
          return { worktreeData: wt as WorktreeSessionGroup, repoOrg: group.repositoryOrg, repoName: group.repositoryName };
      }
    }
    return { worktreeData: null as WorktreeSessionGroup | null, repoOrg: '', repoName: '' };
  }, [sessionGroups, ticketId]);

  const worktreeSessions = useMemo<Session[]>(() => {
    return worktreeData?.sessions ?? [];
  }, [worktreeData]);

  // Tab ordering — persisted via settings sessionOrder using the worktree group key
  const groupId = repoOrg && repoName && worktreeData
    ? `${repoOrg}/${repoName}:${worktreeData.branch}`
    : '';
  const savedOrder = useSettingsStore((s) => s.settings.sessionOrder[groupId]);
  const setSessionOrder = useSettingsStore((s) => s.setSessionOrder);

  // Build the canonical unordered tab list
  const rawTabs = useMemo<ActiveTab[]>(() => [
    ...worktreeSessions.map((s) => ({ kind: 'session' as const, sessionId: s.id })),
    ...executions.map((e) => ({ kind: 'execution' as const, executionId: e.id })),
  ], [worktreeSessions, executions]);

  // Apply saved order
  const allTabs = useMemo<ActiveTab[]>(() => {
    if (!savedOrder || savedOrder.length === 0) return rawTabs;
    const orderMap = new Map(savedOrder.map((key, i) => [key, i]));
    return [...rawTabs].sort((a, b) => {
      const aOrder = orderMap.get(tabKey(a)) ?? Infinity;
      const bOrder = orderMap.get(tabKey(b)) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [rawTabs, savedOrder]);

  // Active tab state
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);

  // Persist last active tab per worktree
  const setLastActiveTab = useUIStore((s) => s.setLastActiveTab);
  useEffect(() => {
    if (!activeTab || !groupId) return;
    setLastActiveTab(groupId, tabKey(activeTab));
  }, [activeTab, groupId, setLastActiveTab]);

  useEffect(() => {
    loadExecutions(ticketId);
  }, [ticketId, loadExecutions]);

  // Reset active tab when switching to a different agent worktree
  const prevTicketIdRef = useRef(ticketId);
  if (prevTicketIdRef.current !== ticketId) {
    prevTicketIdRef.current = ticketId;
    setActiveTab(null);
  }

  // Restore last active tab from store, or auto-select latest execution
  const savedActiveTab = useUIStore((s) => groupId ? s.lastActiveTabByWorktree[groupId] : undefined);
  useEffect(() => {
    // If active tab no longer exists in available tabs, reset it
    if (activeTab && allTabs.length > 0 && !allTabs.some((t) => tabsMatch(t, activeTab))) {
      setActiveTab(null);
      return;
    }
    if (activeTab) return;
    // Try restoring from saved
    if (savedActiveTab && allTabs.length > 0) {
      const restored = allTabs.find((t) => tabKey(t) === savedActiveTab);
      if (restored) {
        setActiveTab(restored);
        return;
      }
    }
    // Fallback: latest execution, then first session
    if (executions.length > 0) {
      setActiveTab({ kind: 'execution', executionId: executions[0]!.id });
    } else if (worktreeSessions.length > 0) {
      setActiveTab({ kind: 'session', sessionId: worktreeSessions[0]!.id });
    }
  }, [executions, worktreeSessions, allTabs, activeTab, savedActiveTab]);

  // Create new shell session in this worktree
  const handleNewTab = useCallback(async () => {
    const cwd = worktreeData?.path || basePath || '~';
    try {
      const session = await api.createSession({ cwd, type: 'shell' });
      addSessionToGroup(session);
      api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
      setActiveTab({ kind: 'session', sessionId: session.id });
    } catch {
      // silently fail
    }
  }, [worktreeData, basePath, addSessionToGroup, setSessionGroups]);

  // Listen for Cmd+N "new tab" event
  const isWorktreeAvailable = worktreeData?.worktreeStatus !== 'repo_missing' && worktreeData?.worktreeStatus !== 'unavailable';
  useEffect(() => {
    if (!isWorktreeAvailable) return;
    const handler = () => { handleNewTab(); };
    window.addEventListener('fleex:new-tab', handler);
    return () => window.removeEventListener('fleex:new-tab', handler);
  }, [handleNewTab, isWorktreeAvailable]);

  const handleCloseTab = useCallback(async (sessionId: string) => {
    try {
      await api.killSession(sessionId);
      removeSession(sessionId);
      if (activeTab?.kind === 'session' && activeTab.sessionId === sessionId) {
        const remaining = allTabs.filter((t) => !(t.kind === 'session' && t.sessionId === sessionId));
        setActiveTab(remaining.length > 0 ? remaining[0]! : null);
      }
    } catch {
      // silently fail
    }
  }, [activeTab, allTabs, removeSession]);

  // Drag-to-reorder state
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'left' | 'right'>('right');
  const draggedKeyRef = useRef<string | null>(null);

  const handleDragStart = useCallback((key: string) => (e: React.DragEvent) => {
    draggedKeyRef.current = key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-agent-tab', key);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    draggedKeyRef.current = null;
    setDragOverKey(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleDragOver = useCallback((key: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-agent-tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    setDropEdge(e.clientX < midX ? 'left' : 'right');
    setDragOverKey(key);
  }, []);

  const handleDragLeave = useCallback((key: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverKey === key) setDragOverKey(null);
  }, [dragOverKey]);

  const handleDrop = useCallback((targetKey: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceKey = e.dataTransfer.getData('application/x-agent-tab');
    setDragOverKey(null);
    if (!sourceKey || sourceKey === targetKey || !groupId) return;

    const keys = allTabs.map(tabKey);
    const fromIdx = keys.indexOf(sourceKey);
    if (fromIdx === -1) return;
    keys.splice(fromIdx, 1);
    let toIdx = keys.indexOf(targetKey);
    if (toIdx === -1) return;
    if (dropEdge === 'right') toIdx += 1;
    keys.splice(toIdx, 0, sourceKey);

    setSessionOrder(groupId, keys);
  }, [allTabs, dropEdge, groupId, setSessionOrder]);

  // Cmd+Shift+Left/Right keyboard navigation across all tab types
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || !e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if (allTabs.length <= 1 || !activeTab) return;
      e.preventDefault();
      const idx = allTabs.findIndex((t) => tabsMatch(t, activeTab));
      if (idx === -1) return;
      const next = e.key === 'ArrowLeft'
        ? (idx - 1 + allTabs.length) % allTabs.length
        : (idx + 1) % allTabs.length;
      setActiveTab(allTabs[next]!);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [allTabs, activeTab]);

  // Worktree context for the toolbar (independent of active tab)
  const worktreeToolbar = useMemo(() => {
    if (!worktreeData || !repoOrg || !repoName) return undefined;
    return { org: repoOrg, repo: repoName, branch: worktreeData.branch, path: worktreeData.path };
  }, [worktreeData, repoOrg, repoName]);

  if (!ticket) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--theme-text-faint)]">
        Ticket not found
      </div>
    );
  }

  const activeSession = activeTab?.kind === 'session'
    ? worktreeSessions.find((s) => s.id === activeTab.sessionId) ?? null
    : null;

  const activeExecutionId = activeTab?.kind === 'execution' ? activeTab.executionId : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopToolbar worktree={worktreeToolbar} />

      {/* Header — branch info + ticket */}
      <div
        className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3"
        style={{ height: 'var(--header-height)' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-secondary)]">
          <circle cx="5" cy="3.5" r="1.5" />
          <circle cx="5" cy="12.5" r="1.5" />
          <circle cx="12" cy="7" r="1.5" />
          <path d="M5 5v6M5 7.5c0-1.5 1-3 4.5-3" />
        </svg>
        <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
          {worktreeData?.branch ?? 'agent'}
        </span>
        {worktreeData?.worktreeStatus === 'reconciling' && (
          <span className="shrink-0 text-xs text-[var(--theme-text-faint)] animate-pulse">syncing…</span>
        )}
        {(worktreeData?.worktreeStatus === 'repo_missing' || worktreeData?.worktreeStatus === 'unavailable') && (
          <span className="shrink-0 text-xs text-[var(--theme-warning,#f59e0b)]">not available locally</span>
        )}
        <span className="text-xs text-[var(--theme-text-faint)] truncate">
          #{ticket.displayId} {ticket.title}
        </span>
        {ticket.assignee && (
          <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-400">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
              <rect x="3" y="5" width="10" height="8" rx="1.5" />
              <path d="M5.5 8.5h1M9.5 8.5h1" />
              <path d="M6 11h4" />
              <line x1="8" y1="5" x2="8" y2="2.5" />
              <circle cx="8" cy="2" r="0.75" />
            </svg>
            {ticket.assignee}
          </span>
        )}
      </div>

      {/* Tab bar: all tabs (ordered, draggable) + new tab */}
      <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 overflow-x-auto">
        {allTabs.map((tab) => {
          const key = tabKey(tab);
          const isOver = dragOverKey === key && draggedKeyRef.current !== key;
          return (
            <div
              key={key}
              draggable
              onDragStart={handleDragStart(key)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver(key)}
              onDragLeave={handleDragLeave(key)}
              onDrop={handleDrop(key)}
              className="relative"
            >
              {isOver && dropEdge === 'left' && (
                <div className="absolute left-0 top-1 bottom-1 z-10 w-0.5 rounded bg-[var(--theme-accent)]" />
              )}
              {tab.kind === 'session' ? (
                <ShellTab
                  session={worktreeSessions.find((s) => s.id === tab.sessionId)!}
                  isActive={activeTab ? tabsMatch(activeTab, tab) : false}
                  onClick={() => setActiveTab(tab)}
                  onClose={handleCloseTab}
                />
              ) : (
                <ExecutionTab
                  execution={executions.find((e) => e.id === tab.executionId)!}
                  isSelected={activeTab ? tabsMatch(activeTab, tab) : false}
                  onClick={() => setActiveTab(tab)}
                />
              )}
              {isOver && dropEdge === 'right' && (
                <div className="absolute right-0 top-1 bottom-1 z-10 w-0.5 rounded bg-[var(--theme-accent)]" />
              )}
            </div>
          );
        })}

        {/* New Tab button */}
        <button
          className={cn(
            'relative flex items-center gap-1 px-3 py-2 text-xs whitespace-nowrap transition-colors',
            worktreeData?.worktreeStatus === 'repo_missing' || worktreeData?.worktreeStatus === 'unavailable'
              ? 'text-[var(--theme-text-faint)] cursor-not-allowed opacity-50'
              : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
          )}
          onClick={handleNewTab}
          disabled={worktreeData?.worktreeStatus === 'repo_missing' || worktreeData?.worktreeStatus === 'unavailable'}
          title={
            worktreeData?.worktreeStatus === 'repo_missing' ? 'Repository not found locally'
            : worktreeData?.worktreeStatus === 'unavailable' ? 'Worktree unavailable'
            : 'New shell in this worktree'
          }
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          <span>New Tab</span>
          <HotkeyBadge hotkey="⌘N" position="top-right" />
        </button>
      </div>

      {/* Content area */}
      {activeSession ? (
        <TerminalPane session={activeSession} />
      ) : activeExecutionId ? (
        <AgentEventStream executionId={activeExecutionId} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--theme-text-faint)]">
          <span className="text-sm">
            {worktreeData?.worktreeStatus === 'repo_missing' ? 'Repository not found locally'
              : worktreeData?.worktreeStatus === 'unavailable' ? 'Worktree unavailable'
              : 'No executions yet'}
          </span>
          {worktreeData?.worktreeStatus !== 'repo_missing' && worktreeData?.worktreeStatus !== 'unavailable' && (
            <button
              className="rounded-md bg-[var(--theme-accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              onClick={handleNewTab}
            >
              + New Shell Tab
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Minimal terminal pane for inline use — mounts xterm.js for the given session */
function TerminalPane({ session }: { session: Session }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(session.id, containerRef);

  useEffect(() => {
    terminalManager.get(session.id)?.terminal.focus();
  }, [session.id]);

  // Track global last active session (lastActiveTab per worktree is handled by the parent panel)
  const setLastActiveSession = useUIStore((s) => s.setLastActiveSession);
  useEffect(() => {
    setLastActiveSession(session.id);
  }, [session.id, setLastActiveSession]);

  return <div ref={containerRef} className="xterm-container flex-1" />;
}

/** Shell session tab */
function ShellTab({ session, isActive, onClick, onClose }: {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  onClose: (id: string) => void;
}) {
  const status = useMemo(() => deriveDisplayStatus(session), [session]);
  const displayLabel = session.displayName || session.tmuxName || session.id.slice(0, 8);

  return (
    <div
      className={cn(
        'group/tab relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-colors cursor-pointer',
        isActive
          ? 'text-[var(--theme-text-primary)]'
          : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
      )}
      onClick={onClick}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M4 5l3 3-3 3" />
        <line x1="9" y1="11" x2="12" y2="11" />
      </svg>
      <span className="truncate max-w-[120px]">{displayLabel}</span>
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
      {isActive && (
        <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
      )}
    </div>
  );
}

/** Agent execution tab */
function ExecutionTab({ execution, isSelected, onClick }: {
  execution: AgentExecution;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor = execution.status === 'running' ? 'text-blue-400'
    : execution.status === 'completed' ? 'text-green-400'
    : execution.status === 'failed' ? 'text-red-400'
    : 'text-[var(--theme-text-faint)]';

  const time = new Date(execution.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <button
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-colors',
        isSelected
          ? 'text-[var(--theme-text-primary)]'
          : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
      )}
      onClick={onClick}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-violet-400">
        <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
      </svg>
      <span className={cn('w-1.5 h-1.5 rounded-full', statusColor.replace('text-', 'bg-'))} />
      <span>{time}</span>
      <span className="text-[var(--theme-text-faint)]">({execution.eventCount})</span>
      {isSelected && (
        <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
      )}
    </button>
  );
}
