import type { TicketPriority } from '@fleex/shared';
import { TICKET_PRIORITIES } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/** Every priority, most urgent first — the order every picker and filter lists them in. */
export const PRIORITY_ORDER_DESC: readonly TicketPriority[] = [...TICKET_PRIORITIES].reverse();

const PRIORITY_TEXT_COLORS: Record<TicketPriority, string> = {
  none: 'text-[var(--theme-text-secondary)]',
  low: tintText('blue'),
  medium: tintText('yellow'),
  high: tintText('red'),
  urgent: tintText('red'),
};

/** How many of the 3 signal bars are lit for each bar-rendered level. */
const LIT_BARS: Record<'low' | 'medium' | 'high', number> = { low: 1, medium: 2, high: 3 };

const BARS = [
  { x: 2, height: 5 },
  { x: 6.5, height: 8 },
  { x: 11, height: 11 },
];

function BarsIcon({ size, lit }: { size: number; lit: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" data-priority-icon="bars">
      {BARS.map((bar, i) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={14 - bar.height}
          width={3}
          height={bar.height}
          rx={1}
          opacity={i < lit ? 1 : 0.3}
          data-lit={i < lit}
        />
      ))}
    </svg>
  );
}

function NoneIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" data-priority-icon="none">
      <rect x={1.5} y={7} width={3.5} height={2} rx={1} />
      <rect x={6.25} y={7} width={3.5} height={2} rx={1} />
      <rect x={11} y={7} width={3.5} height={2} rx={1} />
    </svg>
  );
}

/**
 * Filled rounded square with a knocked-out "!". The "!" is a hole (even-odd
 * fill), not a white glyph, so it shows whatever is behind the icon and stays
 * readable on any background, including the red-tinted Kanban card.
 */
function UrgentIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" data-priority-icon="urgent">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 1h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3z M8 3.5a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0v-4a1 1 0 0 1 1-1z M8 10.9a1.1 1.1 0 1 0 0 2.2a1.1 1.1 0 1 0 0-2.2z"
      />
    </svg>
  );
}

export function PriorityIndicator({ priority, size = 'sm' }: { priority: TicketPriority; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 12 : 14;
  // Priority is free text in storage: render anything unknown as "none" rather than crash.
  const level: TicketPriority = Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, priority) ? priority : 'none';

  const icon = (() => {
    switch (level) {
      case 'none': return <NoneIcon size={px} />;
      case 'urgent': return <UrgentIcon size={px} />;
      default: return <BarsIcon size={px} lit={LIT_BARS[level]} />;
    }
  })();

  return (
    <span
      className={cn('inline-flex items-center justify-center flex-shrink-0', PRIORITY_TEXT_COLORS[level])}
      title={PRIORITY_LABELS[level]}
    >
      {icon}
    </span>
  );
}
