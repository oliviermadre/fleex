import { useEffect } from 'react';
import type { TicketGroup, Ticket } from '@fleex/shared';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useTicketStore } from '../../stores/ticketStore';
import { StatusCubes } from './StatusCubes';
import { cn } from '../../lib/cn';

/**
 * Horizontal scrollable banner of epic cards above the kanban board.
 * Clicking a card filters the kanban; "All tickets" clears the filter.
 */
export function EpicBanner() {
  const groups = useTicketGroupStore((s) => s.groups);
  const selectedEpicIds = useTicketGroupStore((s) => s.selectedEpicIds);
  const toggleEpicFilter = useTicketGroupStore((s) => s.toggleEpicFilter);
  const clearEpicFilter = useTicketGroupStore((s) => s.clearEpicFilter);
  const fetchGroups = useTicketGroupStore((s) => s.fetchGroups);
  const fetchGroupTickets = useTicketGroupStore((s) => s.fetchGroupTickets);
  const groupTicketIds = useTicketGroupStore((s) => s.groupTicketIds);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const allTickets = useTicketStore((s) => s.tickets);

  // Fetch groups on mount and when board changes
  useEffect(() => {
    fetchGroups(selectedBoardId ?? undefined);
  }, [selectedBoardId, fetchGroups]);

  // Fetch ticket memberships for each group
  useEffect(() => {
    for (const g of groups) {
      if (!groupTicketIds[g.id]) {
        fetchGroupTickets(g.id);
      }
    }
  }, [groups, groupTicketIds, fetchGroupTickets]);

  // Only show active (non-archived) groups
  const visibleGroups = groups.filter((g) => g.groupStatus !== 'archived');

  if (visibleGroups.length === 0) return null;

  const totalTickets = allTickets.length;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto border-b border-[var(--theme-border)] px-3 py-2">
      {/* All tickets tab */}
      <button
        className={cn(
          'flex-shrink-0 rounded-lg border px-3 py-2 text-left transition-colors',
          selectedEpicIds.length === 0
            ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/10'
            : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]',
        )}
        onClick={clearEpicFilter}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs">📋</span>
          <span className="text-xs font-medium text-[var(--theme-text-primary)]">All tickets</span>
        </div>
        <div className="mt-0.5 text-[10px] text-[var(--theme-text-muted)]">
          {totalTickets} tickets
        </div>
      </button>

      {/* Epic cards */}
      {visibleGroups.map((group) => (
        <EpicBannerCard
          key={group.id}
          group={group}
          selected={selectedEpicIds.includes(group.id)}
          tickets={getGroupTickets(group.id, groupTicketIds, allTickets)}
          onClick={() => toggleEpicFilter(group.id)}
        />
      ))}
    </div>
  );
}

function getGroupTickets(
  groupId: string,
  groupTicketIds: Record<string, string[]>,
  allTickets: Ticket[],
): Array<{ id: string; title: string; status: Ticket['status'] }> {
  const ids = groupTicketIds[groupId] ?? [];
  const ticketMap = new Map(allTickets.map((t) => [t.id, t]));
  return ids
    .map((id) => ticketMap.get(id))
    .filter(Boolean)
    .map((t) => ({ id: t!.id, title: t!.title, status: t!.status }));
}

interface EpicBannerCardProps {
  group: TicketGroup;
  selected: boolean;
  tickets: Array<{ id: string; title: string; status: Ticket['status'] }>;
  onClick: () => void;
}

function EpicBannerCard({ group, selected, tickets, onClick }: EpicBannerCardProps) {
  return (
    <button
      className={cn(
        'flex-shrink-0 rounded-lg border px-3 py-2 text-left transition-colors min-w-[140px] max-w-[200px]',
        selected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/10'
          : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]',
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs">{group.emoji}</span>
        <span className="truncate text-xs font-medium text-[var(--theme-text-primary)]">{group.name}</span>
      </div>
      {group.description && (
        <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--theme-text-muted)]">
          {group.description}
        </div>
      )}
      {tickets.length > 0 && (
        <div className="mt-1.5">
          <StatusCubes tickets={tickets} />
        </div>
      )}
    </button>
  );
}
