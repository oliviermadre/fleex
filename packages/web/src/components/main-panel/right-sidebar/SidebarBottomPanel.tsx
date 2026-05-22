import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSidebarTerminalsStore } from '../../../stores/sidebarTerminalsStore';
import { useTerminal } from '../../../hooks/useTerminal';
import * as api from '../../../services/api';

interface Props {
  /** Parent tmux session tab whose sidebar terminals we host. */
  parentSessionId: string;
  /** Ticket display ID — used to name new tmux sessions. */
  ticketDisplayId: number;
  /** Default cwd for new sidebar terminals (typically the parent session cwd). */
  cwd: string;
}

/**
 * Bottom sub-panel: renders a tab strip of auxiliary tmux terminals scoped to
 * a single parent tmux session tab, plus an xterm container for the active one.
 */
export function SidebarBottomPanel({ parentSessionId, ticketDisplayId, cwd }: Props) {
  const allSessions = useSessionStore((s) => s.sessions);
  const addSessionToGroup = useSessionStore((s) => s.addSessionToGroup);
  const removeSession = useSessionStore((s) => s.removeSession);

  const terminalIdsRaw = useSidebarTerminalsStore((s) => s.terminalsByParent[parentSessionId]);
  const activeIdRaw = useSidebarTerminalsStore((s) => s.activeByParent[parentSessionId]);
  const terminalIds = useMemo(() => terminalIdsRaw ?? [], [terminalIdsRaw]);
  const activeId = activeIdRaw ?? null;
  const addTerminal = useSidebarTerminalsStore((s) => s.addTerminal);
  const removeTerminal = useSidebarTerminalsStore((s) => s.removeTerminal);
  const setActive = useSidebarTerminalsStore((s) => s.setActive);
  const reconcile = useSidebarTerminalsStore((s) => s.reconcile);

  // Drop stale references when sessions disappear (e.g. server restart, killed elsewhere)
  useEffect(() => {
    const knownIds = new Set(allSessions.map((s) => s.id));
    reconcile(knownIds);
  }, [allSessions, reconcile]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, typeof allSessions[number]>();
    for (const s of allSessions) map.set(s.id, s);
    return map;
  }, [allSessions]);

  const handleCreate = useCallback(async () => {
    try {
      const session = await api.createSession({
        cwd,
        type: 'shell',
        parentSessionId,
        ticketDisplayId,
      });
      addSessionToGroup(session);
      addTerminal(parentSessionId, session.id);
    } catch {
      // silent
    }
  }, [cwd, parentSessionId, ticketDisplayId, addSessionToGroup, addTerminal]);

  const handleClose = useCallback(
    async (sidebarSessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      removeTerminal(parentSessionId, sidebarSessionId);
      try {
        await api.killSession(sidebarSessionId);
      } catch {
        // ignore — UI already removed it
      }
      removeSession(sidebarSessionId);
    },
    [parentSessionId, removeTerminal, removeSession],
  );

  const activeSession = activeId ? sessionsById.get(activeId) ?? null : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 h-8 flex-shrink-0 overflow-x-auto">
        {terminalIds.map((id) => {
          const s = sessionsById.get(id);
          const label = s?.displayName ?? 'Terminal';
          const isActive = id === activeId;
          return (
            <div
              key={id}
              role="button"
              onClick={() => setActive(parentSessionId, id)}
              className={`group/sidebar-tab relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap cursor-pointer transition-colors ${
                isActive
                  ? 'text-[var(--theme-text-primary)]'
                  : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 opacity-70">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                <path d="M4 6l2 2-2 2M7.5 10h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate max-w-[100px]">{label}</span>
              <button
                type="button"
                onClick={(e) => handleClose(id, e)}
                className="hidden items-center justify-center w-4 h-4 rounded text-[var(--theme-text-faint)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)] group-hover/sidebar-tab:flex"
                title="Close terminal"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleCreate}
          title="New sidebar terminal"
          className="ml-1 inline-flex items-center justify-center w-6 h-6 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)] flex-shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {activeSession ? (
          <SidebarTerminalView key={activeSession.id} sessionId={activeSession.id} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-[var(--theme-text-faint)]">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
              <path d="M4 6l2 2-2 2M7.5 10h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="text-xs text-[var(--theme-text-muted)]">
              No terminal yet
            </div>
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
              New terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarTerminalView({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);
  return <div ref={containerRef} className="xterm-container absolute inset-0" />;
}
