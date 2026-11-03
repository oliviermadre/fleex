import type { Ticket, TicketComplexity } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { usePopover, FloatingPortal, FloatingFocusManager } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { ComplexityBadge, complexityDescription } from './ComplexityBadge';
import { ComplexityGrid, complexityInitialFocus, useComplexityCellRefs } from './ComplexityGrid';

/**
 * Trigger + popover to read and edit a ticket's complexity — the counterpart of
 * `PriorityPickerPopover`, wherever that one is shown.
 *
 * `hideWhenUnset`: on Kanban cards an unestimated ticket shows nothing until
 * the card (the nearest `.group`) is hovered or the trigger is focused.
 */
export function ComplexityPickerPopover({
  ticket,
  size = 'sm',
  hideWhenUnset = false,
}: {
  ticket: Pick<Ticket, 'id' | 'complexity'>;
  size?: 'sm' | 'md';
  hideWhenUnset?: boolean;
}) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const { open, setOpen, refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover();
  const cellRefs = useComplexityCellRefs();
  const value = ticket.complexity ?? null;

  const pick = (c: TicketComplexity | null) => {
    setOpen(false);
    if (c !== value) updateTicket(ticket.id, { complexity: c });
  };

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          'cursor-pointer rounded p-px transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
          hideWhenUnset && value === null && !open && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        )}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        title={`Complexity: ${complexityDescription(value)} — click to change`}
        aria-label={`Complexity: ${complexityDescription(value)}`}
      >
        <ComplexityBadge complexity={value} size={size} />
      </button>

      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={complexityInitialFocus(value)}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps({ onClick: (e) => e.stopPropagation() })}
              className="z-50 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] shadow-xl"
            >
              <ComplexityGrid value={value} onPick={pick} cellRefs={cellRefs} />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
