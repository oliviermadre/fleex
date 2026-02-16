import type { TicketPriority } from '@asm/shared';
import { cn } from '../../lib/cn';

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  none: 'bg-zinc-400',
  low: 'bg-blue-400',
  medium: 'bg-yellow-400',
  high: 'bg-red-400',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function PriorityIndicator({ priority, size = 'sm' }: { priority: TicketPriority; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full flex-shrink-0',
        PRIORITY_COLORS[priority],
        size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5',
      )}
      title={PRIORITY_LABELS[priority]}
    />
  );
}
