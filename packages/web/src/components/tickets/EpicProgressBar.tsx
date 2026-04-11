import type { TicketStatus } from '@fleex/shared';

interface EpicProgressBarProps {
  tickets: Array<{ status: TicketStatus }>;
  showLabel?: boolean;
}

export function EpicProgressBar({ tickets, showLabel = true }: EpicProgressBarProps) {
  const total = tickets.length;
  const doneCount = tickets.filter((t) => t.status === 'done').length;
  const inProgressCount = tickets.filter(
    (t) => t.status === 'doing' || t.status === 'reviewing',
  ).length;

  const donePercent = total > 0 ? (doneCount / total) * 100 : 0;
  const inProgressPercent = total > 0 ? (inProgressCount / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-1">
      {showLabel && (
        <span className="text-xs text-[var(--theme-text-secondary)]">
          {Math.round(donePercent)}% {doneCount}/{total}
        </span>
      )}
      <div className="h-2 rounded-full overflow-hidden bg-[var(--theme-bg-tertiary)]">
        {donePercent > 0 && (
          <div
            className="h-full bg-[var(--color-fleex-cyan,#06b6d4)] float-left"
            style={{ width: `${donePercent}%` }}
          />
        )}
        {inProgressPercent > 0 && (
          <div
            className="h-full bg-[var(--color-fleex-green,#10b981)] opacity-60 float-left"
            style={{ width: `${inProgressPercent}%` }}
          />
        )}
      </div>
    </div>
  );
}
