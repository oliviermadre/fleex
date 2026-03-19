import { useMemo } from 'react';
import type { Ticket } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useTicketStore } from '../../stores/ticketStore';
import { SystemGroup } from './SystemGroup';
import { BoardTicketGroup } from './BoardTicketGroup';

function isSystemGroup(org: string, name: string): boolean {
  return org === '_ungrouped' && name === '_ungrouped';
}

export function WorkspaceGroups() {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const sessions = useSessionStore((s) => s.sessions);
  const tickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);

  const systemSessions = useMemo(() => {
    const ungrouped = sessionGroups.find((g) => isSystemGroup(g.repositoryOrg, g.repositoryName));
    if (!ungrouped) return [];
    return ungrouped.worktrees.flatMap((wt) => wt.sessions);
  }, [sessionGroups]);

  const workspaceTickets = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (t.status === 'doing' || t.status === 'reviewing') &&
          t.links.some((l) => l.type === 'worktree'),
      ),
    [tickets],
  );

  const ticketsByBoard = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const ticket of workspaceTickets) {
      const list = map.get(ticket.boardId) ?? [];
      list.push(ticket);
      map.set(ticket.boardId, list);
    }
    return map;
  }, [workspaceTickets]);

  const activeBoardsSorted = useMemo(
    () =>
      [...boards]
        .filter((b) => ticketsByBoard.has(b.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [boards, ticketsByBoard],
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <SystemGroup sessions={systemSessions} />
      {activeBoardsSorted.map((board) => (
        <BoardTicketGroup
          key={board.id}
          board={board}
          tickets={ticketsByBoard.get(board.id) ?? []}
          sessions={sessions}
        />
      ))}
      {workspaceTickets.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          </svg>
          <p className="text-xs text-[var(--theme-text-faint)]">No active tickets with workspaces</p>
        </div>
      )}
    </div>
  );
}
