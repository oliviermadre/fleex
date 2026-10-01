import { useMemo, type ReactNode } from 'react';
import type { PinnedIcon, WorkspaceAction } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint, tintClasses, tintText } from '../../../lib/tints';
import { buildWorkspaceContext, type WorkspaceContext } from '../../../lib/templateUtils';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTicketStore } from '../../../stores/ticketStore';
import { useWorkStore } from '../../../stores/workStore';
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { useToastStore } from '../../../stores/toastStore';
import type { ActionsScope } from '../../../stores/uiStore';

/** The AI hue: theme tint, so it stays legible on light and dark themes. */
export const AI_TEXT = tintText('purple');
export const AI_CHIP = tint('purple');
export const AI_BUTTON = cn(
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-110 disabled:opacity-50',
  tint('purple'),
);

export function SparkIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z" />
    </svg>
  );
}

export function SuggestedMark() {
  return (
    <span className={cn('inline-flex h-4 items-center gap-1 rounded px-1.5 text-[10px] font-medium', AI_CHIP)}>
      <SparkIcon size={9} /> suggested
    </span>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded bg-[var(--theme-bg-overlay)] px-1.5 text-[11px] text-[var(--theme-text-secondary)]', className)}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    // Inherits the button's text colour, so it stays legible on accent and tinted buttons alike.
    <kbd className="ml-1 rounded border border-current px-1 font-mono text-[10px] opacity-60">{children}</kbd>
  );
}

export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border-input)]')}
    >
      <span className={cn('absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-[var(--theme-bg-surface)] shadow transition-transform', on && 'translate-x-3')} />
    </button>
  );
}

export const SECTION = 'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-5';
export const CODE_INPUT =
  'w-full resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]';
export const TEXT_INPUT =
  'h-8 w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2.5 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]';

/** A small "⋯"-style dropdown: trigger + floating menu, closes on pick, outside click or Escape. */
export function Dropdown({
  trigger,
  children,
  label,
  className,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  label: string;
  className?: string;
}) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'bottom-end' });
  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-label={label}
        className={className}
        {...getReferenceProps({ onClick: (e: React.MouseEvent) => e.stopPropagation() })}
      >
        {trigger}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[220px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {children(() => setOpen(false))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function MenuButton({ children, onClick, danger, hint }: { children: ReactNode; onClick: () => void; danger?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
        danger ? cn('text-[var(--theme-text-secondary)]', tintClasses('red').hoverText) : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]',
      )}
    >
      <span className="flex-1">{children}</span>
      {hint && <span className="font-mono text-[10px] text-[var(--theme-text-faint)]">{hint}</span>}
    </button>
  );
}

/**
 * The ticket a ticket action would run against from Settings: the task open in
 * Work, else the selected ticket. Null when neither exists — "Try" is then disabled.
 */
export function useContextTicket(): WorkspaceContext | null {
  const workTicketId = useWorkStore((s) => s.selectedTicketId);
  const boardTicketId = useTicketStore((s) => s.selectedTicketId);
  const tickets = useTicketStore((s) => s.tickets);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  return useMemo(() => {
    const id = workTicketId ?? boardTicketId;
    const ticket = id ? tickets.find((t) => t.id === id) : undefined;
    return ticket ? buildWorkspaceContext(ticket, basePath) : null;
  }, [workTicketId, boardTicketId, tickets, basePath]);
}

/** Run a saved action from Settings (list row ▶, preview bar). Ticket actions need a context ticket. */
export function useRunFromSettings(scope: ActionsScope) {
  const executePinnedAction = useSettingsStore((s) => s.executePinnedAction);
  const executeWorkspaceAction = useSettingsStore((s) => s.executeWorkspaceAction);
  const context = useContextTicket();
  return (action: PinnedIcon | WorkspaceAction) => {
    if (scope === 'pinned') {
      executePinnedAction(action as PinnedIcon);
      return;
    }
    if (!context) {
      useToastStore.getState().addToast('info', 'Open a ticket first: ticket actions run in its workspace.');
      return;
    }
    executeWorkspaceAction(action, context);
  };
}
