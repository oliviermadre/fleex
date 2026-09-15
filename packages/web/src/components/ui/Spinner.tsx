import { cn } from '../../lib/cn';

/** Inline activity spinner — the same arc as the Kanban card's pending indicators. */
export function Spinner({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn('flex-shrink-0 animate-spin', className)}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" strokeDasharray="30" strokeDashoffset="10" />
    </svg>
  );
}

/** A spinner and a short muted line saying what is in flight ("Removing worktree…"). */
export function BusyLine({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn('flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--theme-text-muted)]', className)}>
      <Spinner size={10} />
      <span className="truncate">{label}</span>
    </div>
  );
}
