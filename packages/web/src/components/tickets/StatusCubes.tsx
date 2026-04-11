import type { TicketStatus } from '@fleex/shared';
import { cn } from '../../lib/cn';

interface StatusCubesProps {
  tickets: Array<{ id: string; title: string; status: TicketStatus }>;
}

const statusColorClass: Record<TicketStatus, string> = {
  backlog: 'bg-[var(--theme-text-muted)]',
  todo: 'bg-[var(--theme-text-secondary)]',
  doing: 'bg-[var(--color-fleex-green,#10b981)]',
  reviewing: 'bg-[var(--color-fleex-amber,#f59e0b)]',
  done: 'bg-[var(--color-fleex-cyan,#06b6d4)]',
  cancelled: 'bg-[var(--theme-text-muted)]',
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
