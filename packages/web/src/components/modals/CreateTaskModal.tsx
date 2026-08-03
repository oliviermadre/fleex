import { useState, useEffect, useCallback, useMemo } from 'react';

import type { Ticket, DashboardPullRequest, BoardWithCounts } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tint, tintSolid, tintText } from '../../lib/tints';
import * as api from '../../services/api';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

type TaskMode = 'ticket' | 'my-prs' | 'review' | 'new';

const MODES: { key: TaskMode; label: string }[] = [
  { key: 'new', label: 'From Scratch' },
  { key: 'ticket', label: 'From Kanban' },
  { key: 'my-prs', label: 'My PRs' },
  { key: 'review', label: 'To Review' },
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function CreateTaskModal() {
  const open = useUIStore((s) => s.createModalOpen);
  const closeModal = useUIStore((s) => s.closeCreateModal);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const openSessionFromTicket = useTicketStore((s) => s.openSessionFromTicket);
  const selectTicketTab = useSessionStore((s) => s.selectTicketTab);
  const createTicket = useTicketStore((s) => s.createTicket);
  const fetchTickets = useTicketStore((s) => s.fetchTickets);
  const boards = useTicketStore((s) => s.boards);
  const tickets = useTicketStore((s) => s.tickets);

  const [mode, setMode] = useState<TaskMode>('new');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // From Ticket
  const [ticketSearch, setTicketSearch] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // My PRs / To Review
  const [myPRs, setMyPRs] = useState<DashboardPullRequest[]>([]);
  const [reviewPRs, setReviewPRs] = useState<DashboardPullRequest[]>([]);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [selectedPR, setSelectedPR] = useState<DashboardPullRequest | null>(null);

  // New task
  const [taskTitle, setTaskTitle] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const repos = useRepositoryStore((s) => s.repositories);
  const fetchRepositories = useRepositoryStore((s) => s.fetchRepositories);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [loadingRepos, setLoadingRepos] = useState(false);

  // Load data when modal opens
  useEffect(() => {
    if (!open) return;
    fetchTickets();
    if (boards.length > 0 && !selectedBoardId) {
      setSelectedBoardId(boards[0]!.id);
    }
    // Load dashboard PRs
    setLoadingPRs(true);
    api
      .fetchDashboard()
      .then((data) => {
        setMyPRs(data.myPullRequests);
        setReviewPRs(data.reviewRequests);
      })
      .catch(() => {})
      .finally(() => setLoadingPRs(false));
  }, [open, fetchTickets, boards, selectedBoardId]);

  // Refresh the repository list on every open. Kept separate from the effect
  // above, whose deps make it re-run on every board change. The list is
  // otherwise loaded once at app boot, so repos added since (from the
  // Repositories panel, the CLI, or another window) would never show up here.
  useEffect(() => {
    if (!open) return;
    setLoadingRepos(true);
    void fetchRepositories().finally(() => setLoadingRepos(false));
  }, [open, fetchRepositories]);

  // Drop selections for repos that are no longer tracked: a ticket linked to an
  // untracked repo is filtered out of the sidebar, so its session would be
  // created but invisible.
  useEffect(() => {
    if (!open) return;
    setSelectedRepos((prev) => {
      if (prev.size === 0) return prev;
      const tracked = new Set(repos.map((r) => `${r.org}/${r.name}`));
      const next = new Set([...prev].filter((key) => tracked.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [open, repos]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setMode('new');
      setTicketSearch('');
      setSelectedTicketId(null);
      setSelectedPR(null);
      setTaskTitle('');
      setSelectedRepos(new Set());
      setError('');
      setCreating(false);
    }
  }, [open]);

  // Filtered tickets for search
  const filteredTickets = useMemo(() => {
    const actionable = tickets.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    if (!ticketSearch.trim()) return actionable.slice(0, 20);
    const q = ticketSearch.toLowerCase();
    return actionable.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 20);
  }, [tickets, ticketSearch]);

  // Toggle repo selection
  const toggleRepo = useCallback((repoKey: string) => {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoKey)) next.delete(repoKey);
      else next.add(repoKey);
      return next;
    });
  }, []);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    setCreating(true);
    setError('');
    try {
      let ticketId: string;

      if (mode === 'ticket') {
        if (!selectedTicketId) return;
        ticketId = selectedTicketId;
      } else if (mode === 'my-prs' || mode === 'review') {
        if (!selectedPR) return;
        // Find or create ticket for this PR
        const prRef = `${selectedPR.org}/${selectedPR.name}#${selectedPR.number}`;
        // Check if a ticket with this PR link already exists
        const existing = tickets.find((t) =>
          t.links.some((l) => l.type === 'github_pr' && l.ref === prRef),
        );
        if (existing) {
          ticketId = existing.id;
        } else {
          // Create a new ticket for this PR
          const boardId = selectedBoardId || boards[0]?.id;
          if (!boardId) {
            setError('No board available');
            return;
          }
          const tag = mode === 'review' ? 'review' : undefined;
          const repoKey = `${selectedPR.org}/${selectedPR.name}`;
          const ticket = await createTicket({
            boardId,
            title: selectedPR.title,
            status: 'todo',
            tags: tag ? [tag] : [],
            links: [
              {
                type: 'github_pr',
                ref: prRef,
                label: `#${selectedPR.number}`,
                url: `https://github.com/${selectedPR.org}/${selectedPR.name}/pull/${selectedPR.number}`,
              },
              { type: 'repository', ref: repoKey, label: selectedPR.name, url: null },
              {
                type: 'worktree',
                ref: `${repoKey}:${selectedPR.headRefName}`,
                label: selectedPR.headRefName,
                url: null,
              },
            ],
          });
          ticketId = ticket.id;
        }
      } else {
        // New task
        if (!taskTitle.trim()) return;
        const boardId = selectedBoardId || boards[0]?.id;
        if (!boardId) {
          setError('No board available');
          return;
        }
        const repoLinks = [...selectedRepos].map((key) => {
          const name = key.split('/')[1] ?? key;
          return { type: 'repository' as const, ref: key, label: name, url: null as string | null };
        });
        const ticket = await createTicket({
          boardId,
          title: taskTitle.trim(),
          status: 'todo',
          links: repoLinks,
        });
        ticketId = ticket.id;
      }

      // Open session from ticket (auto-creates workspace + worktree + session)
      const { sessionId } = await openSessionFromTicket(ticketId);
      // Navigate to session view and wait for session to appear before selecting its tab
      setActivePanel('sessions');
      closeModal();
      const trySelect = () => {
        const sessions = useSessionStore.getState().sessions;
        if (sessions.some((s) => s.id === sessionId)) {
          selectTicketTab(ticketId, `s:${sessionId}`);
          setCreating(false);
        } else {
          setTimeout(trySelect, 200);
        }
      };
      trySelect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      setCreating(false);
    }
  }, [
    mode,
    selectedTicketId,
    selectedPR,
    taskTitle,
    selectedBoardId,
    selectedRepos,
    boards,
    tickets,
    createTicket,
    openSessionFromTicket,
    setActivePanel,
    selectTicketTab,
    closeModal,
  ]);

  // Cmd+Enter to submit
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleSubmit]);

  const isDisabled =
    creating ||
    (mode === 'ticket'
      ? !selectedTicketId
      : mode === 'my-prs' || mode === 'review'
        ? !selectedPR
        : !taskTitle.trim() || selectedRepos.size === 0);

  return (
    <Modal open={open} onClose={closeModal} maxWidth="max-w-3xl">
      {/* Header */}
      <h2 className="mb-4 text-base font-semibold text-[var(--theme-text-primary)]">New Task</h2>

      {/* Mode tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-[var(--theme-bg-overlay)] p-1">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === m.key
                ? 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
            )}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Content per mode */}
      <div className="min-h-[300px]">
        {/* ── From Ticket ── */}
        {mode === 'ticket' && (
          <div>
            <Input
              autoFocus
              className="mb-3 w-full py-2"
              placeholder="Search tickets..."
              value={ticketSearch}
              onChange={(e) => setTicketSearch(e.target.value)}
            />
            <div className="max-h-[260px] overflow-y-auto">
              {filteredTickets.length === 0 ? (
                <p className="py-8 text-center text-xs text-[var(--theme-text-muted)]">
                  No tickets found
                </p>
              ) : (
                filteredTickets.map((t) => (
                  <button
                    key={t.id}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      selectedTicketId === t.id
                        ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                        : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]',
                    )}
                    onClick={() => setSelectedTicketId(t.id)}
                    onDoubleClick={handleSubmit}
                  >
                    <span
                      className={cn(
                        'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
                        t.status === 'doing'
                          ? tintSolid('blue')
                          : t.status === 'todo'
                            ? tintSolid('orange')
                            : 'bg-[var(--theme-text-faint)]',
                      )}
                    />
                    <span className="truncate flex-1">{t.title}</span>
                    <span className="text-[10px] text-[var(--theme-text-faint)]">{t.status}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── My PRs ── */}
        {mode === 'my-prs' && (
          <div>
            {loadingPRs ? (
              <p className="py-8 text-center text-xs text-[var(--theme-text-muted)]">
                Loading PRs...
              </p>
            ) : myPRs.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--theme-text-muted)]">No open PRs</p>
            ) : (
              <div className="max-h-[300px] overflow-y-auto">
                {myPRs.map((pr) => {
                  const prRef = `${pr.org}/${pr.name}#${pr.number}`;
                  const hasTicket = tickets.some((t) =>
                    t.links.some((l) => l.type === 'github_pr' && l.ref === prRef),
                  );
                  return (
                    <button
                      key={prRef}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        selectedPR?.number === pr.number && selectedPR?.org === pr.org
                          ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                          : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]',
                      )}
                      onClick={() => setSelectedPR(pr)}
                      onDoubleClick={handleSubmit}
                    >
                      <span className="text-[var(--theme-text-faint)] text-xs w-8 flex-shrink-0">
                        #{pr.number}
                      </span>
                      <span className="truncate flex-1">{pr.title}</span>
                      <span className="text-[10px] text-[var(--theme-text-faint)] flex-shrink-0">
                        {pr.org}/{pr.name}
                      </span>
                      {hasTicket && (
                        <span
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[9px] font-medium flex-shrink-0',
                            tint('green'),
                          )}
                        >
                          has ticket
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--theme-text-faint)] flex-shrink-0">
                        {timeAgo(pr.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── To Review ── */}
        {mode === 'review' && (
          <div>
            {loadingPRs ? (
              <p className="py-8 text-center text-xs text-[var(--theme-text-muted)]">
                Loading PRs...
              </p>
            ) : reviewPRs.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--theme-text-muted)]">
                No PRs to review
              </p>
            ) : (
              <div className="max-h-[300px] overflow-y-auto">
                {reviewPRs.map((pr) => {
                  const prRef = `${pr.org}/${pr.name}#${pr.number}`;
                  const hasTicket = tickets.some((t) =>
                    t.links.some((l) => l.type === 'github_pr' && l.ref === prRef),
                  );
                  return (
                    <button
                      key={prRef}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        selectedPR?.number === pr.number && selectedPR?.org === pr.org
                          ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                          : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]',
                      )}
                      onClick={() => setSelectedPR(pr)}
                      onDoubleClick={handleSubmit}
                    >
                      <span className="text-[var(--theme-text-faint)] text-xs w-8 flex-shrink-0">
                        #{pr.number}
                      </span>
                      <span className="truncate flex-1">{pr.title}</span>
                      <span className="text-[10px] text-[var(--theme-text-faint)] flex-shrink-0">
                        {pr.author}
                      </span>
                      <span className="text-[10px] text-[var(--theme-text-faint)] flex-shrink-0">
                        {pr.org}/{pr.name}
                      </span>
                      {hasTicket && (
                        <span
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[9px] font-medium flex-shrink-0',
                            tint('green'),
                          )}
                        >
                          has ticket
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--theme-text-faint)] flex-shrink-0">
                        {timeAgo(pr.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── New Task ── */}
        {mode === 'new' && (
          <div className="space-y-4">
            {/* Task title */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">
                Task name
              </label>
              <Input
                autoFocus
                className="w-full py-2"
                placeholder="What needs to be done?"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
            </div>

            {/* Board selector */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">
                Board
              </label>
              <select
                className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                value={selectedBoardId}
                onChange={(e) => setSelectedBoardId(e.target.value)}
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.emoji} {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Repository multi-select */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">
                Repositories ({selectedRepos.size} selected)
              </label>
              <div className="max-h-[160px] overflow-y-auto rounded-md border border-[var(--theme-border)] p-1">
                {repos.length === 0 && (
                  <p className="px-2 py-3 text-center text-xs text-[var(--theme-text-muted)]">
                    {loadingRepos
                      ? 'Loading repositories...'
                      : 'No repositories tracked — add one from the Repositories panel'}
                  </p>
                )}
                {[...repos]
                  .sort((a, b) => a.org.localeCompare(b.org) || a.name.localeCompare(b.name))
                  .map((r) => {
                    const key = `${r.org}/${r.name}`;
                    const selected = selectedRepos.has(key);
                    return (
                      <button
                        key={key}
                        className={cn(
                          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                          selected
                            ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                            : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]',
                        )}
                        onClick={() => toggleRepo(key)}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded border text-[10px] flex-shrink-0',
                            selected
                              ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                              : 'border-[var(--theme-border-input)]',
                          )}
                        >
                          {selected && '✓'}
                        </span>
                        <span className="text-[var(--theme-text-faint)] text-xs">{r.org}/</span>
                        <span className="font-medium">{r.name}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && <p className={`mt-3 text-xs ${tintText('red')}`}>{error}</p>}

      {/* Actions */}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={closeModal}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={isDisabled} onClick={handleSubmit}>
          {creating ? 'Creating...' : mode === 'ticket' ? 'Open Session' : 'Create & Start'}
          {!creating && <span className="ml-2 text-[10px] opacity-60">⌘↵</span>}
        </Button>
      </div>
    </Modal>
  );
}
