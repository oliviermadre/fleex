import type { TicketStatus } from '@fleex/shared';

interface EpicProgressBarProps {
  tickets: Array<{ status: TicketStatus }>;
  showLabel?: boolean;
}

export function EpicProgressBar({ tickets, showLabel = true }: EpicProgressBarProps) {
  const total = tickets.length;
  const doneCount = tickets.filter((t) => t.status === 'done' || t.status === 'cancelled').length;

  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="relative h-8 w-full overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
      {/* Fill */}
      {percent > 0 && (
        <div
          className="absolute inset-y-0 left-0 rounded-lg bg-[var(--theme-accent)]"
          style={{ width: `${percent}%` }}
        />
      )}
      {/* Label inside the bar */}
      {showLabel && (
        <span
          className="absolute inset-0 flex items-center justify-center text-xs font-bold tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
        >
          {percent}%&nbsp;&nbsp;{doneCount}/{total}
        </span>
      )}
    </div>
  );
}
