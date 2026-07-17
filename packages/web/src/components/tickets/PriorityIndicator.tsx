import type { TicketPriority } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const PRIORITY_TEXT_COLORS: Record<TicketPriority, string> = {
  none: 'text-[var(--theme-text-secondary)]',
  low: tintText('blue'),
  medium: tintText('yellow'),
  high: tintText('red'),
};

function ChevronDown({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function ChevronUp({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

function NoneIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 8h8" />
    </svg>
  );
}

function MediumIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h8M4 10h8" />
    </svg>
  );
}

export function PriorityIndicator({ priority, size = 'sm' }: { priority: TicketPriority; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 10 : 12;

  const icon = (() => {
    switch (priority) {
      case 'none': return <NoneIcon size={px} />;
      case 'low': return <ChevronDown size={px} />;
      case 'medium': return <MediumIcon size={px} />;
      case 'high': return <ChevronUp size={px} />;
    }
  })();

  return (
    <span
      className={cn('inline-flex items-center justify-center flex-shrink-0', PRIORITY_TEXT_COLORS[priority])}
      title={PRIORITY_LABELS[priority]}
    >
      {icon}
    </span>
  );
}
