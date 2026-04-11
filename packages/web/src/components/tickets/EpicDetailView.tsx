import { useState, useEffect, useMemo, useCallback } from 'react';
import type { TicketGroup, Ticket, TicketStatus } from '@fleex/shared';
import { TICKET_STATUSES } from '@fleex/shared';
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
              <MiniKanban tickets={epicTickets} />
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

// ── Mini Kanban ──

function MiniKanban({ tickets }: { tickets: Ticket[] }) {
  const byStatus = useMemo(() => {
    const map: Record<TicketStatus, Ticket[]> = {
      backlog: [], todo: [], doing: [], reviewing: [], done: [], cancelled: [],
    };
    for (const t of tickets) {
      map[t.status]?.push(t);
    }
    return map;
  }, [tickets]);

  const statuses = (TICKET_STATUSES as readonly TicketStatus[]).filter((s) => s !== 'cancelled');

  return (
    <div className="flex min-h-0 flex-1 items-stretch">
      {statuses.map((status) => (
        <div key={status} className="flex min-w-[140px] flex-1 flex-col border-r border-[var(--theme-border)] last:border-r-0">
          <div className="flex items-center gap-1.5 border-b border-[var(--theme-border)] px-2 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">{status}</span>
            <span className="text-[10px] text-[var(--theme-text-muted)]">{byStatus[status].length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {byStatus[status].map((ticket) => (
              <div
                key={ticket.id}
                className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2"
              >
                <div className="flex items-center gap-1.5">
                  <PriorityIndicator priority={ticket.priority} />
                  <span className="truncate text-[11px] text-[var(--theme-text-primary)]">{ticket.title}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
