import { useState, useRef } from 'react';
import type { BoardWithCounts } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { BoardSelectorDropdown } from './BoardSelectorDropdown';
import { SearchToggle } from './SearchToggle';
import { FilterDropdown } from './FilterDropdown';
import { cn } from '../../lib/cn';

interface KanbanHeaderProps {
  board: BoardWithCounts | null;
  isAllBoards: boolean;
  onShowArchived?: () => void;
}

const GITHUB_ISSUE_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+\/?$/;

export function KanbanHeader({ board, isAllBoards, onShowArchived }: KanbanHeaderProps) {
  const boards = useTicketStore((s) => s.boards);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const createTicket = useTicketStore((s) => s.createTicket);
  const createBoard = useTicketStore((s) => s.createBoard);
  const importGitHubIssue = useTicketStore((s) => s.importGitHubIssue);

  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickImporting, setQuickImporting] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const quickSubmittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleQuickCreate = async () => {
    if (quickSubmittingRef.current) return;
    const trimmed = quickTitle.trim();
    if (!trimmed) {
      setShowQuickCreate(false);
      return;
    }

    let boardId = selectedBoardId;
    if (!boardId) {
      if (boards.length === 0) {
        await createBoard({ name: 'Default' });
        const updatedBoards = useTicketStore.getState().boards;
        boardId = updatedBoards[0]?.id ?? null;
      } else {
        boardId = boards[0]?.id ?? null;
      }
      if (!boardId) return;
    }

    quickSubmittingRef.current = true;
    setQuickError(null);

    try {
      if (GITHUB_ISSUE_RE.test(trimmed)) {
        setQuickImporting(true);
        await importGitHubIssue(trimmed, boardId);
      } else {
        await createTicket({ boardId, title: trimmed });
      }
      setQuickTitle('');
      setShowQuickCreate(false);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setQuickImporting(false);
      quickSubmittingRef.current = false;
    }
  };

  const activeView = useTicketGroupStore((s) => s.activeView);
  const setActiveView = useTicketGroupStore((s) => s.setActiveView);

  return (
    <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
      {/* Left: Board selector */}
      <BoardSelectorDropdown />

      {/* Board / Roadmap toggle */}
      <div className="flex items-center rounded-md border border-[var(--theme-border)] p-0.5">
        <button
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
            activeView === 'board'
              ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
              : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
          )}
          onClick={() => setActiveView('board')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="4" height="14" rx="1" />
            <rect x="6" y="1" width="4" height="10" rx="1" />
            <rect x="11" y="1" width="4" height="12" rx="1" />
          </svg>
          Board
        </button>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
            activeView === 'roadmap'
              ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
              : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
          )}
          onClick={() => setActiveView('roadmap')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h12M2 8h8M2 13h5" />
          </svg>
          Roadmap
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: Search, Filter, New ticket */}
      <div className="flex items-center gap-2">
        <SearchToggle />
        <FilterDropdown />

        {/* Archived tickets */}
        {onShowArchived && (
          <button
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--theme-border)] px-2.5 text-xs text-[var(--theme-text-muted)] transition-colors hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-primary)]"
            onClick={onShowArchived}
            title="View archived tickets"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="5" rx="1" />
              <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
            Archived
          </button>
        )}

        {/* Quick create popover */}
        <div className="relative">
          {showQuickCreate ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                className="h-8 w-64 rounded-md border border-[var(--theme-accent)] bg-[var(--theme-bg-surface)] px-3 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none"
                placeholder="Title or GitHub issue URL..."
                value={quickTitle}
                onChange={(e) => { setQuickTitle(e.target.value); setQuickError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleQuickCreate(); }
                  if (e.key === 'Escape') { setQuickTitle(''); setShowQuickCreate(false); }
                }}
                onBlur={() => { if (!quickTitle.trim()) setShowQuickCreate(false); }}
                autoFocus
                disabled={quickImporting}
              />
              {quickImporting && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin text-[var(--theme-accent)]">
                  <circle cx="8" cy="8" r="6" strokeDasharray="30" strokeDashoffset="10" />
                </svg>
              )}
              {quickError && (
                <span className="text-[10px] text-[var(--theme-danger)]">{quickError}</span>
              )}
            </div>
          ) : (
            <button
              className="flex h-8 items-center gap-2 rounded-md bg-[var(--theme-accent)] px-3.5 text-sm font-medium text-white transition-colors hover:bg-[var(--theme-accent-hover)]"
              onClick={() => setShowQuickCreate(true)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
              New ticket
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
