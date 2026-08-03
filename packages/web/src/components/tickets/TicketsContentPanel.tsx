import { useState, useRef, useMemo } from 'react';

import type { TicketPriority } from '@fleex/shared';
import { TICKET_PRIORITIES, isSlackMessageUrl, isSlackImportTag } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { NameInputModal } from '../ui/NameInputModal';

import { PriorityIndicator } from './PriorityIndicator';

export function TicketsContentPanel() {
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(
    () => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)),
    [rawBoards],
  );
  const tickets = useTicketStore((s) => s.tickets);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const createBoard = useTicketStore((s) => s.createBoard);
  const updateBoard = useTicketStore((s) => s.updateBoard);
  const deleteBoard = useTicketStore((s) => s.deleteBoard);
  const filters = useTicketStore((s) => s.filters);
  const setFilters = useTicketStore((s) => s.setFilters);
  const clearFilters = useTicketStore((s) => s.clearFilters);
  const searchQuery = useTicketStore((s) => s.searchQuery);
  const setSearchQuery = useTicketStore((s) => s.setSearchQuery);
  const createTicket = useTicketStore((s) => s.createTicket);
  const importGitHubIssue = useTicketStore((s) => s.importGitHubIssue);
  const importSlackMessage = useTicketStore((s) => s.importSlackMessage);

  const [quickTitle, setQuickTitle] = useState('');
  const [quickImporting, setQuickImporting] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const quickSubmittingRef = useRef(false);
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showCreateBoard, setShowCreateBoard] = useState(false);

  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);

  // Collect unique repos (from settings + ticket links) and tags for filter options
  const { repos, tags } = useMemo(() => {
    const repoSet = new Set<string>();
    // Add all repos from settings (resolvedRepositories are already "org/name" strings)
    for (const r of resolvedRepositories) repoSet.add(r);
    // Also include any repos referenced by tickets but not in settings
    for (const t of tickets) {
      for (const l of t.links) {
        if (l.type === 'worktree') {
          const colonIdx = l.ref.indexOf(':');
          if (colonIdx > 0) repoSet.add(l.ref.substring(0, colonIdx));
        }
      }
    }
    const tagSet = new Set<string>();
    for (const t of tickets) {
      // Reserved Slack-import lifecycle tags are status, not user-filterable tags.
      for (const tag of t.tags) if (!isSlackImportTag(tag)) tagSet.add(tag);
    }
    return { repos: [...repoSet].sort(), tags: [...tagSet].sort() };
  }, [tickets, resolvedRepositories]);

  const activeFilterCount =
    (filters.repo ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.hasSession !== null ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.favorite !== null ? 1 : 0);

  const GITHUB_ISSUE_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+\/?$/;

  const handleQuickCreate = async () => {
    if (quickSubmittingRef.current) return;
    const trimmed = quickTitle.trim();
    if (!trimmed) return;

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
      } else if (isSlackMessageUrl(trimmed)) {
        setQuickImporting(true);
        await importSlackMessage(trimmed, boardId);
      } else {
        await createTicket({ boardId, title: trimmed });
      }
      setQuickTitle('');
    } catch (err) {
      console.error('Failed to import from link:', err);
      setQuickError(err instanceof Error ? err.message : 'Failed to import from link');
    } finally {
      setQuickImporting(false);
      quickSubmittingRef.current = false;
    }
  };

  const handleCreateBoard = () => setShowCreateBoard(true);

  const handleConfirmCreateBoard = async (name: string) => {
    await createBoard({ name });
  };

  const handleStartRename = (boardId: string, currentName: string) => {
    setRenamingBoardId(boardId);
    setRenameValue(currentName);
  };

  const handleFinishRename = async () => {
    if (renamingBoardId && renameValue.trim()) {
      await updateBoard(renamingBoardId, { name: renameValue.trim() });
    }
    setRenamingBoardId(null);
    setRenameValue('');
  };

  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  const selectedBoard = selectedBoardId ? boards.find((b) => b.id === selectedBoardId) : null;

  return (
    <div className="flex h-full flex-col">
      <NameInputModal
        open={showCreateBoard}
        title="Créer un board"
        placeholder="Nom du board"
        onConfirm={handleConfirmCreateBoard}
        onClose={() => setShowCreateBoard(false)}
      />
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[var(--theme-border)] px-4"
        style={{ height: 'var(--header-height)' }}
      >
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Tickets
        </span>
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            onClick={handleCreateBoard}
            title="Create board"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
          <button
            onClick={toggleContentPanel}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title="Collapse panel"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              <line x1="6" y1="1.5" x2="6" y2="14.5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Board selector */}
        <div className="border-b border-[var(--theme-border)] px-3 py-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Board
          </label>
          <select
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
            value={selectedBoardId ?? '__all__'}
            onChange={(e) => selectBoard(e.target.value === '__all__' ? null : e.target.value)}
          >
            {boards.length > 1 && <option value="__all__">All boards</option>}
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.emoji} {b.name}
              </option>
            ))}
          </select>

          {/* Board actions: rename / delete */}
          {selectedBoard && (
            <div className="mt-1.5 flex items-center gap-1">
              {renamingBoardId === selectedBoard.id ? (
                <input
                  autoFocus
                  className="flex-1 rounded border border-[var(--theme-border-input)] bg-transparent px-1.5 py-0.5 text-[10px] text-[var(--theme-text-primary)] focus:outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') {
                      setRenamingBoardId(null);
                      setRenameValue('');
                    }
                  }}
                  onBlur={handleFinishRename}
                />
              ) : (
                <>
                  <button
                    className="rounded px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
                    onClick={() => handleStartRename(selectedBoard.id, selectedBoard.name)}
                  >
                    Rename
                  </button>
                  {boards.length > 1 && (
                    <button
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-danger)]',
                        tintClasses('red').hoverBg,
                      )}
                      onClick={() => {
                        if (confirm(`Delete board "${selectedBoard.name}"?`)) {
                          deleteBoard(selectedBoard.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Quick create */}
        <div className="border-b border-[var(--theme-border)] px-3 py-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Quick Create
          </label>
          <input
            type="text"
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2.5 py-1.5 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            placeholder="Ticket title, GitHub issue or Slack message URL..."
            value={quickTitle}
            onChange={(e) => {
              setQuickTitle(e.target.value);
              setQuickError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleQuickCreate();
              }
            }}
            disabled={quickImporting}
          />
          {GITHUB_ISSUE_RE.test(quickTitle.trim()) && !quickImporting && !quickError && (
            <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--theme-text-muted)]">
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="text-[var(--theme-text-secondary)]"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span>Will import from GitHub</span>
            </div>
          )}
          {quickError && (
            <span className="text-[10px] text-[var(--theme-danger)]">{quickError}</span>
          )}
          {quickImporting && (
            <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--theme-accent)]">
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="animate-spin"
              >
                <circle cx="8" cy="8" r="6" strokeDasharray="30" strokeDashoffset="10" />
              </svg>
              <span>Importing from GitHub...</span>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="border-b border-[var(--theme-border)] px-3 py-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Search
          </label>
          <div className="relative">
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]"
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="7" cy="7" r="5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
            <input
              type="text"
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] py-1.5 pl-7 pr-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
              Filters
            </label>
            {activeFilterCount > 0 && (
              <button
                className="rounded px-1.5 py-0.5 text-[10px] text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                onClick={clearFilters}
              >
                Clear ({activeFilterCount})
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            {/* Repository */}
            {repos.length > 0 && (
              <div>
                <label className="mb-0.5 block text-[10px] text-[var(--theme-text-muted)]">
                  Repository
                </label>
                <select
                  className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                  value={filters.repo ?? ''}
                  onChange={(e) => setFilters({ repo: e.target.value || null })}
                >
                  <option value="">All</option>
                  {repos.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Priority */}
            <div>
              <label className="mb-0.5 block text-[10px] text-[var(--theme-text-muted)]">
                Priority
              </label>
              <div className="flex flex-wrap gap-1">
                <button
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                    !filters.priority
                      ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                      : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                  )}
                  onClick={() => setFilters({ priority: null })}
                >
                  All
                </button>
                {(TICKET_PRIORITIES as readonly TicketPriority[]).map((p) => (
                  <button
                    key={p}
                    className={cn(
                      'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
                      filters.priority === p
                        ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                        : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                    )}
                    onClick={() => setFilters({ priority: p })}
                  >
                    <PriorityIndicator priority={p} />
                    {p === 'none' ? 'None' : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Has session */}
            <div>
              <label className="mb-0.5 block text-[10px] text-[var(--theme-text-muted)]">
                Session
              </label>
              <div className="flex gap-1">
                {(
                  [
                    { label: 'All', value: null },
                    { label: 'With session', value: true },
                    { label: 'Without', value: false },
                  ] as const
                ).map((opt) => (
                  <button
                    key={String(opt.value)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                      filters.hasSession === opt.value
                        ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                        : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                    )}
                    onClick={() => setFilters({ hasSession: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Favorite */}
            <div>
              <label className="mb-0.5 block text-[10px] text-[var(--theme-text-muted)]">
                Favorite
              </label>
              <div className="flex gap-1">
                {(
                  [
                    { label: 'All', value: null },
                    { label: '\u2605 Favorites', value: true },
                  ] as const
                ).map((opt) => (
                  <button
                    key={String(opt.value)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                      filters.favorite === opt.value
                        ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                        : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                    )}
                    onClick={() => setFilters({ favorite: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div>
                <label className="mb-0.5 block text-[10px] text-[var(--theme-text-muted)]">
                  Tag
                </label>
                <select
                  className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                  value={filters.tag ?? ''}
                  onChange={(e) => setFilters({ tag: e.target.value || null })}
                >
                  <option value="">All</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
