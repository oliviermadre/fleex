import { useState, useRef, useEffect, useMemo } from 'react';
import { NameInputModal } from '../ui/NameInputModal';
import { createPortal } from 'react-dom';
import { useTicketStore } from '../../stores/ticketStore';
import { BoardActionsDropdown } from './BoardActionsDropdown';
import { cn } from '../../lib/cn';

export function BoardSelectorDropdown() {
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(() => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)), [rawBoards]);
  const tickets = useTicketStore((s) => s.tickets);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const createBoard = useTicketStore((s) => s.createBoard);
  const ticketsByColumn = useTicketStore((s) => s.ticketsByColumn);
  const filters = useTicketStore((s) => s.filters);
  const searchQuery = useTicketStore((s) => s.searchQuery);

  const [open, setOpen] = useState(false);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAllBoards = selectedBoardId === null && boards.length > 1;
  const selectedBoard = selectedBoardId ? boards.find((b) => b.id === selectedBoardId) : null;

  // Use client-side filtered count so badge matches what the kanban actually shows
  const columns = ticketsByColumn(selectedBoardId);
  const totalCount = (Object.values(columns) as import('@fleex/shared').Ticket[][]).reduce((sum, col) => sum + col.length, 0);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleCreateBoard = () => {
    setOpen(false);
    setShowCreateBoard(true);
  };

  const handleConfirmCreateBoard = async (name: string) => {
    await createBoard({ name });
  };

  const handleSelect = (id: string | null) => {
    selectBoard(id);
    setOpen(false);
  };

  const rect = buttonRef.current?.getBoundingClientRect();

  return (
    <>
    <NameInputModal
      open={showCreateBoard}
      title="Créer un board"
      placeholder="Nom du board"
      onConfirm={handleConfirmCreateBoard}
      onClose={() => setShowCreateBoard(false)}
    />
    <div className="flex items-center gap-1">
      <button
        ref={buttonRef}
        className={cn(
          'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]',
          open && 'bg-[var(--theme-bg-hover)]',
        )}
        onClick={() => setOpen(!open)}
      >
        {isAllBoards ? (
          <span className="font-mono font-semibold">All Boards</span>
        ) : selectedBoard ? (
          <>
            <span>{selectedBoard.emoji}</span>
            <span className="font-mono font-semibold">{selectedBoard.name}</span>
          </>
        ) : boards.length === 1 && boards[0] ? (
          <>
            <span>{boards[0].emoji}</span>
            <span className="font-mono font-semibold">{boards[0].name}</span>
          </>
        ) : (
          <span className="font-mono font-semibold">Boards</span>
        )}

        <span className="rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-xs font-medium text-[var(--theme-text-muted)]">
          {totalCount as number}
        </span>

        {/* Chevron */}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-muted)]">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>

      {/* Pencil icon for selected board actions */}
      {selectedBoard && (
        <BoardActionsDropdown board={selectedBoard} />
      )}

      {open && rect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[220px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1.5 shadow-xl"
          style={{ left: rect.left, top: rect.bottom + 4 }}
        >
          {/* All Boards option */}
          {boards.length > 1 && (
            <>
              <button
                className={cn(
                  'flex w-full items-center justify-between px-3.5 py-2 text-left text-sm transition-colors',
                  isAllBoards
                    ? 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                    : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                )}
                onClick={() => handleSelect(null)}
              >
                <span className="font-medium">All Boards</span>
                <span className="text-xs text-[var(--theme-text-muted)]">{(Object.values(ticketsByColumn(null)) as import('@fleex/shared').Ticket[][]).reduce((s, c) => s + c.length, 0)}</span>
              </button>
              <div className="my-1 border-t border-[var(--theme-border)]" />
            </>
          )}

          {/* Board list */}
          {boards.map((b) => {
            const count = (Object.values(ticketsByColumn(b.id)) as import('@fleex/shared').Ticket[][]).reduce((sum, c) => sum + c.length, 0);
            return (
              <button
                key={b.id}
                className={cn(
                  'flex w-full items-center justify-between px-3.5 py-2 text-left text-sm transition-colors',
                  selectedBoardId === b.id
                    ? 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                    : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                )}
                onClick={() => handleSelect(b.id)}
              >
                <span className="flex items-center gap-2">
                  <span>{b.emoji}</span>
                  <span className="font-medium">{b.name}</span>
                </span>
                <span className="text-xs text-[var(--theme-text-muted)]">{count as number}</span>
              </button>
            );
          })}

          {/* Create new board */}
          <div className="my-1 border-t border-[var(--theme-border)]" />
          <button
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            onClick={handleCreateBoard}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
            <span>New board</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
    </>
  );
}
