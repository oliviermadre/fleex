import { useState, useCallback, useMemo, useEffect } from 'react';
import { NameInputModal } from '../ui/NameInputModal';
import { TICKET_STATUSES } from '@fleex/shared';
import type { TicketStatus, Ticket } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { fetchBulkPRStates } from '../../services/api';
import { KanbanColumn } from './KanbanColumn';
import { KanbanHeader } from './KanbanHeader';
import { ArchivedTicketsModal } from './ArchivedTicketsModal';
import { EpicBanner } from './EpicBanner';
import { RoadmapView } from './RoadmapView';
import { EpicDetailView } from './EpicDetailView';
import { useUnreadStore } from '../../stores/unreadStore';

export function KanbanBoard() {
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(() => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)), [rawBoards]);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const ticketsByColumn = useTicketStore((s) => s.ticketsByColumn);
  const tickets = useTicketStore((s) => s.tickets);
  const filters = useTicketStore((s) => s.filters);
  const searchQuery = useTicketStore((s) => s.searchQuery);
  const loadUnreadCounts = useUnreadStore((s) => s.loadUnreadCounts);

  // Epic stores
  const activeView = useTicketGroupStore((s) => s.activeView);
  const selectedEpicDetailId = useTicketGroupStore((s) => s.selectedEpicDetailId);
  const selectedEpicIds = useTicketGroupStore((s) => s.selectedEpicIds);
  const groupTicketIds = useTicketGroupStore((s) => s.groupTicketIds);

  // Load unread counts on mount and when tickets change
  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  useEffect(() => { loadUnreadCounts(ticketIds); }, [ticketIds, loadUnreadCounts]);

  const [prStates, setPrStates] = useState<Record<string, string>>({});

  // Fetch live PR states for all visible tickets with github_pr links
  useEffect(() => {
    const prRefs = new Set<string>();
    for (const ticket of tickets) {
      for (const link of ticket.links) {
        if (link.type === 'github_pr') prRefs.add(link.ref);
      }
    }
    if (prRefs.size === 0) return;
    fetchBulkPRStates([...prRefs]).then(setPrStates).catch(() => {});
  }, [tickets]);

  // Collapsed columns state with localStorage persistence
  const COLLAPSED_STORAGE_KEY = 'fleex:collapsedColumns';
  const [collapsedColumns, setCollapsedColumns] = useState<Set<TicketStatus>>(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored) as TicketStatus[]);
    } catch { /* ignore */ }
    return new Set<TicketStatus>(['cancelled']);
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsedColumns]));
  }, [collapsedColumns]);

  const toggleCollapse = useCallback((status: TicketStatus) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const [showArchived, setShowArchived] = useState(false);

  const isAllBoards = selectedBoardId === null && boards.length > 1;
  const board = selectedBoardId ? boards.find((b) => b.id === selectedBoardId) ?? null : null;

  const createBoard = useTicketStore((s) => s.createBoard);
  const [showCreateBoard, setShowCreateBoard] = useState(false);

  const handleCreateBoard = () => setShowCreateBoard(true);

  const handleConfirmCreateBoard = async (name: string) => {
    await createBoard({ name });
  };

  if (!board && !isAllBoards && boards.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--theme-bg-base)]">
        <NameInputModal
          open={showCreateBoard}
          title="Créer un board"
          placeholder="Nom du board"
          onConfirm={handleConfirmCreateBoard}
          onClose={() => setShowCreateBoard(false)}
        />
        <div className="text-center">
          <p className="text-sm text-[var(--theme-text-muted)]">No board yet</p>
          <button
            className="mt-2 rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--theme-accent-hover)]"
            onClick={handleCreateBoard}
          >
            Create board
          </button>
        </div>
      </div>
    );
  }

  // If epic detail is open, show it
  if (selectedEpicDetailId) {
    return <EpicDetailView />;
  }

  // If roadmap view is active, show it
  if (activeView === 'roadmap') {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
        <KanbanHeader
          board={board}
          isAllBoards={isAllBoards}
          hideActions
        />
        <RoadmapView />
      </div>
    );
  }

  // Filter tickets by selected epics
  const columns = ticketsByColumn(selectedBoardId);
  const filteredColumns = filterColumnsByEpics(columns, selectedEpicIds, groupTicketIds);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      <KanbanHeader
        board={board}
        isAllBoards={isAllBoards}
        onShowArchived={() => setShowArchived(true)}
      />
      {showArchived && (
        <ArchivedTicketsModal
          boardId={selectedBoardId}
          boards={boards}
          onClose={() => setShowArchived(false)}
        />
      )}
      <EpicBanner />
      <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">
        {(TICKET_STATUSES as readonly TicketStatus[]).map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tickets={filteredColumns[status] ?? []}
            boardId={selectedBoardId ?? boards[0]?.id ?? ''}
            isAllBoards={isAllBoards}
            boards={isAllBoards ? boards : undefined}
            collapsed={collapsedColumns.has(status)}
            onToggleCollapse={() => toggleCollapse(status)}
            prStates={prStates}
          />
        ))}
      </div>

    </div>
  );
}

/** Filter kanban columns to only show tickets belonging to the selected epics. */
function filterColumnsByEpics(
  columns: Record<string, Ticket[]>,
  selectedEpicIds: string[],
  groupTicketIds: Record<string, string[]>,
): Record<string, Ticket[]> {
  if (selectedEpicIds.length === 0) return columns;

  // Collect the union of all ticket IDs from selected epics
  const allowedIds = new Set<string>();
  for (const epicId of selectedEpicIds) {
    for (const ticketId of (groupTicketIds[epicId] ?? [])) {
      allowedIds.add(ticketId);
    }
  }

  const result: Record<string, Ticket[]> = {};
  for (const [status, tickets] of Object.entries(columns)) {
    result[status] = tickets.filter((t) => allowedIds.has(t.id));
  }
  return result;
}
