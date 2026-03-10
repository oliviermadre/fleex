import type { DisplayStatus } from '../../lib/deriveStatus';
import { cn } from '../../lib/cn';

interface Props {
  status: DisplayStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Animated status indicator dot.
 * - executing / working: pulsing blue (ping ring)
 * - needs-approval: fixed amber
 * - idle / unknown: fixed gray
 */
export function StatusDot({ status, size = 'md', className }: Props) {
  const px = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  const isActive = status === 'executing' || status === 'working';

  if (isActive) {
    return (
      <span className={cn('relative inline-flex shrink-0', px, className)}>
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-500 opacity-60" />
        <span className={cn('relative inline-flex rounded-full bg-blue-500', px)} />
      </span>
    );
  }

  const color =
    status === 'needs-approval' ? 'bg-amber-400' : 'bg-[var(--theme-text-muted)]';

  return (
    <span className={cn('shrink-0 rounded-full', px, color, className)} />
  );
}
