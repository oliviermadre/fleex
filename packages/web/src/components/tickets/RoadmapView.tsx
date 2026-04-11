import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TicketGroup, TicketGroupTimeframe, Ticket } from '@fleex/shared';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useTicketStore } from '../../stores/ticketStore';
import { EpicProgressBar } from './EpicProgressBar';
import { PriorityIndicator } from './PriorityIndicator';
import { cn } from '../../lib/cn';

interface RoadmapColumnDef {
  id: string;
  label: string;
  titleColor: string;
  badgeColor: string;
  filter: (g: TicketGroup) => boolean;
  collapsible: boolean;
}

// Match kanban column color pattern (Tailwind classes, not CSS vars)
const COLUMNS: RoadmapColumnDef[] = [
  { id: 'now', label: 'NOW', titleColor: 'text-green-400', badgeColor: 'text-green-400 bg-green-400/10', filter: (g) => g.groupStatus === 'active' && g.timeframe === 'now', collapsible: false },
  { id: 'next', label: 'NEXT', titleColor: 'text-orange-400', badgeColor: 'text-orange-400 bg-orange-400/10', filter: (g) => g.groupStatus === 'active' && g.timeframe === 'next', collapsible: false },
  { id: 'later', label: 'LATER', titleColor: 'text-[var(--theme-text-muted)]', badgeColor: 'text-[var(--theme-text-muted)] bg-[var(--theme-bg-overlay)]', filter: (g) => g.groupStatus === 'active' && g.timeframe === 'later', collapsible: false },
  { id: 'done', label: 'DONE', titleColor: 'text-blue-400', badgeColor: 'text-blue-400 bg-blue-400/10', filter: (g) => g.groupStatus === 'done', collapsible: true },
  { id: 'cancelled', label: 'CANCELLED', titleColor: 'text-red-400/70', badgeColor: 'text-red-400/70 bg-red-400/10', filter: (g) => g.groupStatus === 'cancelled', collapsible: true },
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

  const visibleGroups = groups.filter((g) => g.groupStatus !== 'archived');

  const handleDragStart = (e: React.DragEvent, groupId: string) => {
    e.dataTransfer.setData('application/x-epic-id', groupId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedGroupId(groupId);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    if (!e.dataTransfer.types.includes('application/x-epic-id')) return;
    if (collapsed[columnId]) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDraggedGroupId(null);

    const epicId = e.dataTransfer.getData('application/x-epic-id');
    if (!epicId) return;

    if (columnId === 'done') {
      await updateGroup(epicId, { groupStatus: 'done' });
    } else if (columnId === 'cancelled') {
      await updateGroup(epicId, { groupStatus: 'cancelled' });
    } else {
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

        // ── Collapsed column (matches KanbanColumn collapsed) ──
        if (col.collapsible && isCollapsed) {
          return (
            <div
              key={col.id}
              className={cn(
                'flex w-11 flex-shrink-0 flex-col items-center border-l border-[var(--theme-border)]',
                dragOverColumn === col.id && 'ring-2 ring-inset ring-[var(--theme-accent)]/50',
              )}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <button
                className="flex w-full items-center justify-center py-2 text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-secondary)]"
                onClick={() => setCollapsed((p) => ({ ...p, [col.id]: false }))}
                title={`Expand ${col.label}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', col.badgeColor)}>
                {colGroups.length}
              </span>
              <span
                className={cn('mt-3 text-xs font-bold uppercase tracking-wider', col.titleColor)}
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {col.label}
              </span>
            </div>
          );
        }

        // ── Expanded column (matches KanbanColumn expanded) ──
        return (
          <div
            key={col.id}
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--theme-border)]',
              dragOverColumn === col.id && 'ring-2 ring-inset ring-[var(--theme-accent)]/50',
            )}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            {/* Column header — matches KanbanColumn header */}
            <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-4 py-3">
              <span className={cn('text-sm font-bold uppercase tracking-wider', col.titleColor)}>
                {col.label}
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', col.badgeColor)}>
                {colGroups.length}
              </span>
              {col.collapsible && (
                <button
                  className="ml-auto flex items-center justify-center text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-secondary)]"
                  onClick={() => setCollapsed((p) => ({ ...p, [col.id]: true }))}
                  title={`Collapse ${col.label}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Add objective at top (matches InlineCardCreator placement) */}
            {!col.collapsible && (
              <div className="px-3 py-1.5">
                <button
                  className="flex w-full items-center gap-1.5 text-xs text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-secondary)]"
                  onClick={() => handleAddObjective(col.id as TicketGroupTimeframe)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="8" y1="3" x2="8" y2="13" />
                    <line x1="3" y1="8" x2="13" y2="8" />
                  </svg>
                  Add objective
                </button>
              </div>
            )}

            {/* Cards — matches KanbanColumn card list */}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-2">
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Roadmap Card (matches KanbanCard styling) ──

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
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{group.emoji}</span>
        <span className={cn(
          'text-sm font-medium text-[var(--theme-text-primary)]',
          isStrikethrough && 'line-through opacity-60',
        )}>
          {group.name}
        </span>
      </div>

      {group.description && (
        <div className="mt-1 line-clamp-2 text-[11px] text-[var(--theme-text-muted)]">
          {group.description}
        </div>
      )}

      <div className="mt-2">
        <EpicProgressBar tickets={tickets} />
      </div>

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
