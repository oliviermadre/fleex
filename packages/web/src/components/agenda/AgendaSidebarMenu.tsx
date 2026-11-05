import type { ReactNode } from 'react';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { MoreIcon } from '../ui/icons/AgendaIcons';

/**
 * A "⋯" trigger at the right of a sidebar row, opening a panel with that row's
 * long option list (one checkbox per routine, the Google calendars…) so the
 * sidebar itself stays short. `hint` is a short status next to the trigger
 * ("2 hidden", "Set up").
 */
export function AgendaSidebarMenu({ label, hint, hintTone = 'muted', children }: {
  label: string;
  hint?: string | null;
  hintTone?: 'muted' | 'warning';
  children: ReactNode;
}) {
  const { open, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'right-start', role: 'dialog', maxHeight: 480 });
  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          'flex h-5 shrink-0 items-center gap-1 rounded px-1 text-[10.5px] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]',
          open ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
        )}
      >
        {hint && <span className={hintTone === 'warning' ? 'text-[var(--theme-warning)]' : undefined}>{hint}</span>}
        <MoreIcon size={12} />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-72 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1.5 text-xs text-[var(--theme-text-secondary)] shadow-xl"
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
