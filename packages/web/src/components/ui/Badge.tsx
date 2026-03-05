import { cn } from '../../lib/cn';
import type { SessionType } from '@fleex/shared';

interface BadgeProps {
  type: SessionType;
  className?: string;
}

export function Badge({ type, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        type === 'shell' && 'bg-emerald-500/15 text-emerald-400',
        type === 'claude' && 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]',
        className
      )}
    >
      {type === 'shell' ? 'Shell' : 'Claude Code'}
    </span>
  );
}
