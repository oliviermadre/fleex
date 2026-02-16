import { useState, useCallback, useMemo } from 'react';
import { TICKET_STATUSES } from '@asm/shared';
import type { TicketStatus, Session } from '@asm/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { KanbanColumn } from './KanbanColumn';
import { KanbanHeader } from './KanbanHeader';
import { SessionTerminalOverlay } from './SessionTerminalOverlay';

export function KanbanBoard() {
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(() => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)), [rawBoards]);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const ticketsByColumn = useTicketStore((s) => s.ticketsByColumn);
  const tickets = useTicketStore((s) => s.tickets);
  const openSessionFromTicket = useTicketStore((s) => s.openSessionFromTicket);
  const sessions = useSessionStore((s) => s.sessions);

  const [overlaySession, setOverlaySession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const isAllBoards = selectedBoardId === null && boards.length > 1;
  const board = selectedBoardId ? boards.find((b) => b.id === selectedBoardId) ?? null : null;

  // Find an existing running session for a ticket's worktree
  const findSessionForTicket = useCallback((ticketId: string): Session | null => {
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return null;

    // Check session links first
    const sessionLink = ticket.links.find((l) => l.type === 'session');
    if (sessionLink) {
      const session = sessions.find((s) => s.id === sessionLink.ref && s.status === 'running');
      if (session) return session;
    }

    // Check worktree link and find matching session
    const wtLink = ticket.links.find((l) => l.type === 'worktree');
    if (wtLink) {
      const colonIdx = wtLink.ref.indexOf(':');
      if (colonIdx > 0) {
        const repoKey = wtLink.ref.substring(0, colonIdx);
        const branch = wtLink.ref.substring(colonIdx + 1);
        const [org, name] = repoKey.split('/');
        const session = sessions.find(
          (s) =>
            s.status === 'running' &&
            s.type === 'claude' &&
            s.repositoryOrg === org &&
            s.repositoryName === name &&
            s.worktreeBranch === branch,
        );
        if (session) return session;
      }
    }

    return null;
  }, [tickets, sessions]);

  const handleOpenSession = useCallback(async (ticketId: string) => {
    // Try to find existing active session
    const existing = findSessionForTicket(ticketId);
    if (existing) {
      setOverlaySession(existing);
      return;
    }

    // No existing session — create one via API
    setLoading(ticketId);
    try {
      const { sessionId } = await openSessionFromTicket(ticketId);
      // Wait a tick for session store to update via WS, then find it
      const tryOpen = () => {
        const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (session) {
          setOverlaySession(session);
          setLoading(null);
        } else {
          // Retry briefly — session might arrive via WS
          setTimeout(tryOpen, 300);
        }
      };
      tryOpen();
    } catch {
      setLoading(null);
    }
  }, [findSessionForTicket, openSessionFromTicket]);

  if (!board && !isAllBoards && boards.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--theme-bg-base)]">
        <div className="text-center">
          <p className="text-sm text-[var(--theme-text-muted)]">No board yet</p>
          <p className="mt-1 text-xs text-[var(--theme-text-faint)]">Create a board from the sidebar</p>
        </div>
      </div>
    );
  }

  const columns = ticketsByColumn(selectedBoardId);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      <KanbanHeader
        board={board}
        isAllBoards={isAllBoards}
      />
      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-hidden p-4">
        {(TICKET_STATUSES as readonly TicketStatus[]).map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tickets={columns[status] ?? []}
            boardId={selectedBoardId ?? boards[0]?.id ?? ''}
            isAllBoards={isAllBoards}
            boards={isAllBoards ? boards : undefined}
            onOpenSession={handleOpenSession}
          />
        ))}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="fixed bottom-4 right-4 z-40 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-2 text-xs text-[var(--theme-text-secondary)] shadow-lg">
          Creating session...
        </div>
      )}

      {/* Session terminal overlay */}
      {overlaySession && (
        <SessionTerminalOverlay
          session={overlaySession}
          onClose={() => setOverlaySession(null)}
        />
      )}
    </div>
  );
}
