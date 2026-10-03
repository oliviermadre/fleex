import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Minimum touch target on the phone (iOS HIG) — the size of the composer's send button. */
export const TAP = 'min-h-11 min-w-11';

/**
 * The one header every mobile screen uses, so titles sit in the same place at
 * the same size: [back] [icon] Title [count] ····· [contextual actions], with an
 * optional second line (`sub`) for filters, search or stats.
 */
export function MobilePageHeader({
  title,
  icon,
  count,
  onBack,
  trailing,
  sub,
  className,
}: {
  title: string;
  icon?: ReactNode;
  count?: ReactNode;
  onBack?: () => void;
  trailing?: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex shrink-0 flex-col gap-1.5 border-b border-[var(--theme-border)] px-4 pb-2.5 pt-1.5', className)}>
      <div className="flex h-11 items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="-ml-3 flex h-11 w-11 shrink-0 items-center justify-center text-[28px] leading-none text-[var(--theme-accent)]"
          >
            ‹
          </button>
        )}
        {icon && <span className="flex shrink-0 text-[var(--theme-accent)]">{icon}</span>}
        <h1 className="shrink-0 text-2xl font-bold leading-none tracking-tight">{title}</h1>
        {count !== undefined && count !== null && (
          <span className="shrink-0 rounded-full bg-[var(--theme-bg-overlay)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[var(--theme-text-secondary)]">
            {count}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {trailing && <div className="flex min-w-0 items-center gap-2">{trailing}</div>}
      </div>
      {sub}
    </header>
  );
}

/** Round-rect icon button, 44×44, same look as the Focus bell. */
export function HeaderIconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[var(--theme-bg-surface)]',
        active ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]',
      )}
    >
      {children}
    </button>
  );
}
