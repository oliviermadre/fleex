import type { TicketStatus } from '@fleex/shared';
import { getActiveStatusModel } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { statusColorToken } from '../../lib/statusColors';

interface StatusCubesProps {
  tickets: Array<{ id: string; title: string; status: TicketStatus }>;
}

// Cube color follows the active status model (matches kanban column colors).
const cubeColor = (status: string) => statusColorToken(status).bar;

const CUBE_CLASS = 'w-2.5 h-2.5 rounded-[2px]';

// Display order follows the status model.
const statusOrder = (): string[] =>
  [...getActiveStatusModel().columns].sort((a, b) => a.order - b.order).map((c) => c.key);

export function StatusCubes({ tickets }: StatusCubesProps) {
  if (tickets.length === 0) return null;

  // Individual mode: one cube per ticket
  if (tickets.length <= 6) {
    return (
      <div className="flex items-center gap-0.5">
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            className={cn(CUBE_CLASS, cubeColor(ticket.status))}
            title={ticket.title}
          />
        ))}
      </div>
    );
  }

  // Condensed mode: group by status with counts
  const grouped = tickets.reduce<Record<string, number>>((acc, ticket) => {
    acc[ticket.status] = (acc[ticket.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex items-center gap-1.5">
      {statusOrder().filter((status) => grouped[status]).map((status) => (
        <div key={status} className="flex items-center gap-0.5">
          <div className={cn(CUBE_CLASS, cubeColor(status))} />
          <span className="text-[9px] font-mono text-[var(--theme-text-secondary)]">
            {grouped[status]}
          </span>
        </div>
      ))}
    </div>
  );
}
