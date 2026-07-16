import type { DisplayStatus } from '../../lib/deriveStatus';
import { cn } from '../../lib/cn';
import { tintSolid } from '../../lib/tints';

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
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none', tintSolid('blue'))} />
        <span className={cn('relative inline-flex rounded-full', tintSolid('blue'), px)} />
      </span>
    );
  }

  const color =
    status === 'needs-approval' ? tintSolid('yellow') : 'bg-[var(--theme-text-muted)]';

  return (
    <span className={cn('shrink-0 rounded-full', px, color, className)} />
  );
}
