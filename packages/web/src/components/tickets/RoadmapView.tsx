import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TicketGroup, TicketGroupTimeframe, TicketGroupStatus, Ticket } from '@fleex/shared';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useTicketStore } from '../../stores/ticketStore';
import { EpicProgressBar } from './EpicProgressBar';
import { PriorityIndicator } from './PriorityIndicator';
import { cn } from '../../lib/cn';

interface RoadmapColumnDef {
  id: string;
  label: string;
  accent: string;
  filter: (g: TicketGroup) => boolean;
  collapsible: boolean;
}

const COLUMNS: RoadmapColumnDef[] = [
  { id: 'now', label: 'NOW', accent: 'var(--color-fleex-green, #10b981)', filter: (g) => g.groupStatus === 'active' && g.timeframe === 'now', collapsible: false },
  { id: 'next', label: 'NEXT', accent: 'var(--color-fleex-amber, #f59e0b)', filter: (g) => g.groupStatus === 'active' && g.timeframe === 'next', collapsible: false },
  { id: 'later', label: 'LATER', accent: 'var(--theme-text-muted)', filter: (g) => g.groupStatus === 'active' && g.timeframe === 'later', collapsible: false },
  { id: 'done', label: 'DONE', accent: 'var(--color-fleex-cyan, #06b6d4)', filter: (g) => g.groupStatus === 'done', collapsible: true },
  { id: 'cancelled', label: 'CANCELLED', accent: 'var(--theme-danger, #ef4444)', filter: (g) => g.groupStatus === 'cancelled', collapsible: true },
];

export function RoadmapView() {
  const groups = useTicketGroupStore((s) => s.groups);
  const fetchGroups = useTicketGroupStore((s) => s.fetchGroups);
  const updateGroup = useTicketGroupStore((s) => s.updateGroup);
  const createGroup = useTicketGroupStore((s) => s.createGroup);
  const setSelectedEpicDetail = useTicketGroupStore((s) => s.setSelectedEpicDetail);
  const fetchGroupTickets = useTicketGroupStore((s) => s.fetchGroupTickets);
  const groupTicketIds = useTicketGroupStore((s) => s.groupTicketIds);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const allTickets = useTicketStore((s) => s.tickets);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ cancelled: true });
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  useEffect(() => {
    fetchGroups(selectedBoardId ?? undefined);
  }, [selectedBoardId, fetchGroups]);

  // Fetch tickets for each group
  useEffect(() => {
    for (const g of groups) {
      if (!groupTicketIds[g.id]) {
        fetchGroupTickets(g.id);
      }
    }
  }, [groups, groupTicketIds, fetchGroupTickets]);

  const ticketMap = useMemo(() => new Map(allTickets.map((t) => [t.id, t])), [allTickets]);

  const getGroupTickets = useCallback((groupId: string): Ticket[] => {
    const ids = groupTicketIds[groupId] ?? [];
    return ids.map((id) => ticketMap.get(id)).filter(Boolean) as Ticket[];
  }, [groupTicketIds, ticketMap]);

  // Non-archived groups
  const visibleGroups = groups.filter((g) => g.groupStatus !== 'archived');

  const handleDragStart = (e: React.DragEvent, groupId: string) => {
    e.dataTransfer.setData('application/x-epic-id', groupId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedGroupId(groupId);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    if (!e.dataTransfer.types.includes('application/x-epic-id')) return;
    // Don't accept drops on collapsed columns
    if (collapsed[columnId]) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDraggedGroupId(null);

    const epicId = e.dataTransfer.getData('application/x-epic-id');
    if (!epicId) return;

    // Determine new state based on column
    if (columnId === 'done') {
      await updateGroup(epicId, { groupStatus: 'done' });
    } else if (columnId === 'cancelled') {
      await updateGroup(epicId, { groupStatus: 'cancelled' });
    } else {
      // now, next, later
      await updateGroup(epicId, {
        groupStatus: 'active',
        timeframe: columnId as TicketGroupTimeframe,
      });
    }
  };

  const handleDragEnd = () => {
    setDraggedGroupId(null);
    setDragOverColumn(null);
  };

  const handleAddObjective = async (timeframe: TicketGroupTimeframe) => {
    const name = prompt('Epic name:');
    if (!name) return;
    const boardId = selectedBoardId ?? useTicketStore.getState().boards[0]?.id;
    if (!boardId) return;
    await createGroup({ boardId, name, timeframe });
  };

  return (
    <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">
      {COLUMNS.map((col) => {
        const colGroups = visibleGroups.filter(col.filter);
        const isCollapsed = collapsed[col.id] ?? false;

        if (col.collapsible && isCollapsed) {
          return (
            <button
              key={col.id}
              className="flex w-8 flex-shrink-0 cursor-pointer flex-col items-center justify-start border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)] pt-3 transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => setCollapsed((p) => ({ ...p, [col.id]: false }))}
            >
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: col.accent, writingMode: 'vertical-lr' }}
              >
                {col.label}
              </span>
              <span className="mt-1 text-[9px] text-[var(--theme-text-muted)]">{colGroups.length}</span>
            </button>
          );
        }

        return (
          <div
            key={col.id}
            className={cn(
              'flex min-w-[220px] flex-1 flex-col border-r border-[var(--theme-border)] last:border-r-0',
              dragOverColumn === col.id && 'bg-[var(--theme-accent)]/5',
            )}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)]">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: col.accent }}>
                {col.label}
              </span>
              <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
                {colGroups.length}
              </span>
              {col.collapsible && (
                <button
                  className="ml-auto text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
                  onClick={() => setCollapsed((p) => ({ ...p, [col.id]: true }))}
                  title="Collapse"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <polyline points="4,6 8,10 12,6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {colGroups.map((group) => (
                <RoadmapCard
                  key={group.id}
                  group={group}
                  tickets={getGroupTickets(group.id)}
                  isDragging={draggedGroupId === group.id}
                  showTicketList={col.id !== 'done' && col.id !== 'cancelled'}
                  onDragStart={(e) => handleDragStart(e, group.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setSelectedEpicDetail(group.id)}
                />
              ))}

              {/* Add objective button */}
              {!col.collapsible && (
                <button
                  className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-2 text-xs text-[var(--theme-text-muted)] transition-colors hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]"
                  onClick={() => handleAddObjective(col.id as TicketGroupTimeframe)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="8" y1="3" x2="8" y2="13" />
                    <line x1="3" y1="8" x2="13" y2="8" />
                  </svg>
                  Add objective
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Roadmap Card ──

interface RoadmapCardProps {
  group: TicketGroup;
  tickets: Ticket[];
  isDragging: boolean;
  showTicketList: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}

function RoadmapCard({ group, tickets, isDragging, showTicketList, onDragStart, onDragEnd, onClick }: RoadmapCardProps) {
  const isStrikethrough = group.groupStatus === 'done' || group.groupStatus === 'cancelled';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 transition-all hover:border-[var(--theme-border-input)]',
        isDragging && 'rotate-2 opacity-50 shadow-lg',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{group.emoji}</span>
        <span className={cn(
          'text-sm font-medium text-[var(--theme-text-primary)]',
          isStrikethrough && 'line-through opacity-60',
        )}>
          {group.name}
        </span>
      </div>

      {/* Description */}
      {group.description && (
        <div className="mt-1 line-clamp-2 text-[11px] text-[var(--theme-text-muted)]">
          {group.description}
        </div>
      )}

      {/* Progress bar */}
      <div className="mt-2">
        <EpicProgressBar tickets={tickets} />
      </div>

      {/* Ticket list */}
      {showTicketList && tickets.length > 0 && (
        <div className="mt-2 space-y-1">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="flex items-center gap-1.5 text-[11px]">
              <PriorityIndicator priority={ticket.priority} />
              <span className="truncate text-[var(--theme-text-secondary)]">{ticket.title}</span>
              <span className="ml-auto flex-shrink-0 text-[9px] text-[var(--theme-text-muted)]">
                {ticket.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
