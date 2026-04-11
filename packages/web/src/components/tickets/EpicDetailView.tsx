import { useState, useEffect, useMemo, useCallback } from 'react';
import type { TicketGroup, Ticket, TicketStatus } from '@fleex/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useTicketStore } from '../../stores/ticketStore';
import { EpicProgressBar } from './EpicProgressBar';
import { PriorityIndicator } from './PriorityIndicator';
import { cn } from '../../lib/cn';

export function EpicDetailView() {
  const epicId = useTicketGroupStore((s) => s.selectedEpicDetailId);
  const groups = useTicketGroupStore((s) => s.groups);
  const updateGroup = useTicketGroupStore((s) => s.updateGroup);
  const deleteGroup = useTicketGroupStore((s) => s.deleteGroup);
  const archiveGroup = useTicketGroupStore((s) => s.archiveGroup);
  const unarchiveGroup = useTicketGroupStore((s) => s.unarchiveGroup);
  const setSelectedEpicDetail = useTicketGroupStore((s) => s.setSelectedEpicDetail);
  const fetchGroupTickets = useTicketGroupStore((s) => s.fetchGroupTickets);
  const groupTicketIds = useTicketGroupStore((s) => s.groupTicketIds);
  const allTickets = useTicketStore((s) => s.tickets);

  const [activeTab, setActiveTab] = useState<'description' | 'tickets' | 'deliverables' | 'activity'>('description');

  const group = groups.find((g) => g.id === epicId) ?? null;

  useEffect(() => {
    if (epicId && !groupTicketIds[epicId]) {
      fetchGroupTickets(epicId);
    }
  }, [epicId, groupTicketIds, fetchGroupTickets]);

  const ticketMap = useMemo(() => new Map(allTickets.map((t) => [t.id, t])), [allTickets]);
  const epicTickets = useMemo(() => {
    if (!epicId) return [];
    const ids = groupTicketIds[epicId] ?? [];
    return ids.map((id) => ticketMap.get(id)).filter(Boolean) as Ticket[];
  }, [epicId, groupTicketIds, ticketMap]);

  const handleBack = useCallback(() => setSelectedEpicDetail(null), [setSelectedEpicDetail]);

  if (!group) return null;

  const handleStatusChange = async (status: 'active' | 'done' | 'cancelled') => {
    if (status === 'active') {
      await updateGroup(group.id, { groupStatus: 'active' });
    } else {
      await updateGroup(group.id, { groupStatus: status });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete epic "${group.name}"? Tickets will not be deleted.`)) return;
    await deleteGroup(group.id);
    setSelectedEpicDetail(null);
  };

  const statusBadgeColor: Record<string, string> = {
    active: 'bg-[var(--color-fleex-green,#10b981)]',
    done: 'bg-[var(--color-fleex-cyan,#06b6d4)]',
    cancelled: 'bg-[var(--theme-danger,#ef4444)]',
    archived: 'bg-[var(--theme-text-muted)]',
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
          onClick={handleBack}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="10,3 5,8 10,13" />
          </svg>
          Back
        </button>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium text-white', statusBadgeColor[group.groupStatus] ?? '')}>
          {group.groupStatus.charAt(0).toUpperCase() + group.groupStatus.slice(1)}
        </span>
        <span className="text-lg">{group.emoji}</span>
        <span className="text-sm font-semibold text-[var(--theme-text-primary)]">{group.name}</span>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Description */}
          {group.description && (
            <div className="border-b border-[var(--theme-border)] px-4 py-2">
              <p className="text-xs text-[var(--theme-text-muted)]">{group.description}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-[var(--theme-border)]">
            {(['description', 'tickets', 'deliverables', 'activity'] as const).map((tab) => (
              <button
                key={tab}
                className={cn(
                  'border-b-2 px-4 py-2 text-xs font-medium transition-colors',
                  activeTab === tab
                    ? 'border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                    : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'tickets' && ` (${epicTickets.length})`}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'description' && (
              <div className="p-4 text-sm text-[var(--theme-text-secondary)]">
                {group.description || (
                  <span className="italic text-[var(--theme-text-muted)]">No description yet.</span>
                )}
              </div>
            )}

            {activeTab === 'tickets' && (
              <TicketsTab epicId={epicId!} boardId={group.boardId} epicTickets={epicTickets} />
            )}

            {activeTab === 'deliverables' && (
              <div className="flex items-center justify-center p-8 text-xs text-[var(--theme-text-muted)]">
                Deliverables will appear here.
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="flex items-center justify-center p-8 text-xs text-[var(--theme-text-muted)]">
                Activity log will appear here.
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-[272px] flex-shrink-0 overflow-y-auto border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
          {/* Status */}
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Status</label>
            <div className="flex gap-1">
              {(['active', 'done', 'cancelled'] as const).map((s) => (
                <button
                  key={s}
                  className={cn(
                    'rounded px-2 py-1 text-[10px] font-medium transition-colors',
                    group.groupStatus === s
                      ? 'bg-[var(--theme-accent)] text-white'
                      : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                  )}
                  onClick={() => handleStatusChange(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Progress</label>
            <EpicProgressBar tickets={epicTickets} />
          </div>

          {/* Timeframe */}
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Timeframe</label>
            <span className="text-xs text-[var(--theme-text-primary)] capitalize">{group.timeframe}</span>
          </div>

          {/* Type */}
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Type</label>
            <span className="text-xs text-[var(--theme-text-primary)]">Manual</span>
          </div>

          {/* Tags placeholder */}
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Tags</label>
            <span className="text-[10px] text-[var(--theme-text-muted)]">+ Add tag</span>
          </div>

          {/* Blocked */}
          <div className="mb-3 flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Blocked</label>
            <button
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                group.blocked ? 'bg-[var(--theme-danger)]' : 'bg-[var(--theme-bg-overlay)]',
              )}
              onClick={() => updateGroup(group.id, { blocked: !group.blocked })}
            >
              <span className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                group.blocked ? 'left-[18px]' : 'left-0.5',
              )} />
            </button>
          </div>

          {/* Favorite */}
          <div className="mb-4 flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Favorite</label>
            <button
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                group.favorite ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-bg-overlay)]',
              )}
              onClick={() => updateGroup(group.id, { favorite: !group.favorite })}
            >
              <span className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                group.favorite ? 'left-[18px]' : 'left-0.5',
              )} />
            </button>
          </div>

          {/* Archive / Unarchive */}
          {(group.groupStatus === 'done' || group.groupStatus === 'cancelled') && (
            <button
              className="mb-2 w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => archiveGroup(group.id)}
            >
              Archive
            </button>
          )}
          {group.groupStatus === 'archived' && (
            <button
              className="mb-2 w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => unarchiveGroup(group.id)}
            >
              Unarchive
            </button>
          )}

          {/* Delete */}
          <button
            className="w-full rounded-md border border-[var(--theme-danger)]/30 px-3 py-1.5 text-xs text-[var(--theme-danger)] transition-colors hover:bg-[var(--theme-danger)]/10"
            onClick={handleDelete}
          >
            Delete Epic
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tickets Tab (mini-kanban + manage button) ──

const COLUMN_TITLE_COLOR: Record<string, string> = {
  backlog: 'text-[var(--theme-text-muted)]',
  todo: 'text-orange-400',
  doing: 'text-blue-400',
  reviewing: 'text-purple-400',
  done: 'text-green-400',
  cancelled: 'text-red-400/70',
};

const COLUMN_BADGE_COLOR: Record<string, string> = {
  backlog: 'text-[var(--theme-text-muted)] bg-[var(--theme-bg-overlay)]',
  todo: 'text-orange-400 bg-orange-400/10',
  doing: 'text-blue-400 bg-blue-400/10',
  reviewing: 'text-purple-400 bg-purple-400/10',
  done: 'text-green-400 bg-green-400/10',
  cancelled: 'text-red-400/70 bg-red-400/10',
};

function TicketsTab({ epicId, boardId, epicTickets }: { epicId: string; boardId: string; epicTickets: Ticket[] }) {
  const [showPicker, setShowPicker] = useState(false);

  const byStatus = useMemo(() => {
    const map: Record<TicketStatus, Ticket[]> = {
      backlog: [], todo: [], doing: [], reviewing: [], done: [], cancelled: [],
    };
    for (const t of epicTickets) {
      map[t.status]?.push(t);
    }
    return map;
  }, [epicTickets]);

  const removeTicketFromGroup = useTicketGroupStore((s) => s.removeTicketFromGroup);
  const statuses = TICKET_STATUSES as readonly TicketStatus[];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Manage tickets button */}
      <div className="px-3 py-1.5">
        <button
          className="w-full rounded-md px-3 py-2 text-left text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          onClick={() => setShowPicker(true)}
        >
          + Manage tickets
        </button>
      </div>

      {/* Mini Kanban — matches KanbanColumn styling */}
      <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">
        {statuses.map((status) => (
          <div key={status} className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--theme-border)]">
            {/* Header — matches KanbanColumn */}
            <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-4 py-3">
              <span className={cn('text-sm font-bold uppercase tracking-wider', COLUMN_TITLE_COLOR[status])}>
                {TICKET_STATUS_LABELS[status]}
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', COLUMN_BADGE_COLOR[status])}>
                {byStatus[status].length}
              </span>
            </div>

            {/* Cards — matches KanbanColumn card list */}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-2">
              {byStatus[status].map((ticket) => (
                <div
                  key={ticket.id}
                  className="group rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 transition-colors hover:border-[var(--theme-border-input)]"
                >
                  <div className="flex items-start gap-1.5">
                    <PriorityIndicator priority={ticket.priority} />
                    <span className="min-w-0 flex-1 text-sm text-[var(--theme-text-primary)]">{ticket.title}</span>
                    <button
                      className="flex-shrink-0 rounded p-0.5 text-[var(--theme-text-faint)] opacity-0 transition-opacity hover:text-[var(--theme-danger)] group-hover:opacity-100"
                      onClick={() => removeTicketFromGroup(epicId, ticket.id)}
                      title="Remove from epic"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="4" y1="4" x2="12" y2="12" />
                        <line x1="12" y1="4" x2="4" y2="12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Ticket Picker Modal */}
      {showPicker && (
        <TicketPickerModal
          epicId={epicId}
          boardId={boardId}
          epicTicketIds={new Set(epicTickets.map((t) => t.id))}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ── Ticket Picker Modal ──

const STATUS_SORT_ORDER: Record<string, number> = {
  backlog: 0, todo: 1, doing: 2, reviewing: 3, done: 4, cancelled: 5,
};

function TicketPickerModal({ epicId, boardId, epicTicketIds, onClose }: {
  epicId: string;
  boardId: string;
  epicTicketIds: Set<string>;
  onClose: () => void;
}) {
  const allTickets = useTicketStore((s) => s.tickets);
  const groups = useTicketGroupStore((s) => s.groups);
  const groupTicketIds = useTicketGroupStore((s) => s.groupTicketIds);
  const addTicketToGroup = useTicketGroupStore((s) => s.addTicketToGroup);
  const removeTicketFromGroup = useTicketGroupStore((s) => s.removeTicketFromGroup);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  // Filter by board, unarchived, search; sort by status then title
  const boardTickets = useMemo(() => {
    return allTickets
      .filter((t) => t.boardId === boardId && !t.archivedAt)
      .filter((t) => !search || t.title.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const statusDiff = (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return a.title.localeCompare(b.title);
      });
  }, [allTickets, boardId, search]);

  const ticketEpicLabels = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of groups) {
      const ids = groupTicketIds[g.id] ?? [];
      for (const id of ids) {
        if (!map[id]) map[id] = [];
        map[id].push(`${g.emoji} ${g.name}`);
      }
    }
    return map;
  }, [groups, groupTicketIds]);

  const handleToggle = async (ticketId: string) => {
    if (toggling.has(ticketId)) return;
    setToggling((s) => new Set([...s, ticketId]));
    try {
      if (epicTicketIds.has(ticketId)) {
        await removeTicketFromGroup(epicId, ticketId);
      } else {
        await addTicketToGroup(epicId, ticketId);
      }
    } finally {
      setToggling((s) => { const n = new Set(s); n.delete(ticketId); return n; });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[var(--theme-border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Manage tickets</span>
          <div className="flex-1" />
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]">
              <circle cx="7" cy="7" r="5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
            <input
              type="text"
              autoFocus
              className="h-8 w-64 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] pl-8 pr-3 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Column headers (fixed, not scrollable) */}
        <div className="flex flex-shrink-0 items-center border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          <span className="flex-1">Ticket</span>
          <span className="w-24 flex-shrink-0">Status</span>
          <span className="w-40 flex-shrink-0">Epics</span>
          <span className="w-16 flex-shrink-0 text-center">In epic</span>
        </div>

        {/* Scrollable rows */}
        <div className="min-h-0 flex-1 overflow-y-auto epic-picker-scroll">
          {boardTickets.map((ticket) => {
            const isIn = epicTicketIds.has(ticket.id);
            const isLoading = toggling.has(ticket.id);
            return (
              <div
                key={ticket.id}
                className="flex items-center border-b border-[var(--theme-border)] px-4 py-2 transition-colors hover:bg-[var(--theme-bg-hover)]"
              >
                {/* Ticket name */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <PriorityIndicator priority={ticket.priority} />
                  <span className="truncate text-sm text-[var(--theme-text-primary)]">{ticket.title}</span>
                </div>
                {/* Status */}
                <div className="w-24 flex-shrink-0">
                  <span className={cn('text-xs font-medium', COLUMN_TITLE_COLOR[ticket.status])}>
                    {TICKET_STATUS_LABELS[ticket.status]}
                  </span>
                </div>
                {/* Epics */}
                <div className="flex w-40 flex-shrink-0 flex-wrap gap-1">
                  {(ticketEpicLabels[ticket.id] ?? []).map((label) => (
                    <span key={label} className="truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-secondary)]">
                      {label}
                    </span>
                  ))}
                </div>
                {/* Toggle */}
                <div className="flex w-16 flex-shrink-0 items-center justify-center">
                  <button
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      isIn ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-bg-overlay)]',
                      isLoading && 'opacity-50',
                    )}
                    onClick={() => handleToggle(ticket.id)}
                    disabled={isLoading}
                  >
                    <span className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                      isIn ? 'left-[18px]' : 'left-0.5',
                    )} />
                  </button>
                </div>
              </div>
            );
          })}
          {boardTickets.length === 0 && (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--theme-text-muted)]">
              No tickets found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
