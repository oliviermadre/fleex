import type { TicketStatus } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { STATUS_COLORS } from '../../lib/statusColors';

interface StatusCubesProps {
  tickets: Array<{ id: string; title: string; status: TicketStatus }>;
}

// Match kanban column colors (tint solids)
const statusColorClass: Record<TicketStatus, string> = {
  backlog: 'bg-[var(--theme-text-muted)]',
  todo: STATUS_COLORS.todo!.bar,
  doing: STATUS_COLORS.doing!.bar,
  reviewing: STATUS_COLORS.reviewing!.bar,
  done: STATUS_COLORS.done!.bar,
  cancelled: STATUS_COLORS.cancelled!.bar,
};

const CUBE_CLASS = 'w-2.5 h-2.5 rounded-[2px]';

const STATUS_ORDER: TicketStatus[] = ['doing', 'reviewing', 'todo', 'backlog', 'done', 'cancelled'];

export function StatusCubes({ tickets }: StatusCubesProps) {
  if (tickets.length === 0) return null;

  // Individual mode: one cube per ticket
  if (tickets.length <= 6) {
    return (
      <div className="flex items-center gap-0.5">
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            className={cn(CUBE_CLASS, statusColorClass[ticket.status])}
            title={ticket.title}
          />
        ))}
      </div>
    );
  }

  // Condensed mode: group by status with counts
  const grouped = tickets.reduce<Partial<Record<TicketStatus, number>>>((acc, ticket) => {
    acc[ticket.status] = (acc[ticket.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex items-center gap-1.5">
      {STATUS_ORDER.filter((status) => grouped[status]).map((status) => (
        <div key={status} className="flex items-center gap-0.5">
          <div className={cn(CUBE_CLASS, statusColorClass[status])} />
          <span className="text-[9px] font-mono text-[var(--theme-text-secondary)]">
            {grouped[status]}
          </span>
        </div>
      ))}
    </div>
  );
}
