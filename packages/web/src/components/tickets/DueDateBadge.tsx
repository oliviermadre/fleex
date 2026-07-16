import type { TicketStatus } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

interface DueDateBadgeProps {
  dueDate: string | null;
  status: TicketStatus;
  size?: 'sm' | 'md';
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function differenceInDays(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((a.getTime() - b.getTime()) / msPerDay);
}

export function DueDateBadge({ dueDate, status, size = 'sm' }: DueDateBadgeProps) {
  if (!dueDate) return null;

  const now = new Date();
  const currentDay = startOfDay(now);
  const deadlineDay = startOfDay(new Date(dueDate));
  const daysRemaining = differenceInDays(deadlineDay, currentDay);

  const isDone = status === 'done';

  let label: string;
  let showWarning = false;

  if (daysRemaining < 0) {
    label = `+${Math.abs(daysRemaining)}j`;
    showWarning = true;
  } else {
    label = `J-${daysRemaining}`;
  }

  // Compute human-readable title for accessibility
  const dateFormatted = new Date(dueDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const titleLabel =
    daysRemaining === 0
      ? `Aujourd'hui — ${dateFormatted}`
      : daysRemaining < 0
        ? `Dépassé de ${Math.abs(daysRemaining)}j — ${dateFormatted}`
        : `Dans ${daysRemaining}j — ${dateFormatted}`;

  const colorClass = isDone
    ? 'text-[var(--theme-text-faint)] bg-[var(--theme-bg-overlay)]'
    : daysRemaining > 7
      ? 'text-[var(--theme-text-faint)] bg-[var(--theme-bg-overlay)]'
      : daysRemaining >= 1
        ? tintText('yellow') + ' bg-[var(--tint-yellow-bg)]'
        : tintText('red') + ' bg-[var(--tint-red-bg)]';

  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';

  return (
    <span
      className={cn('inline-flex items-center gap-0.5 rounded font-medium', colorClass, sizeClass)}
      title={titleLabel}
    >
      {showWarning && !isDone && (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
          <path d="M8.22 1.754a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047zM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-.25-5.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5z" />
        </svg>
      )}
      {label}
    </span>
  );
}
