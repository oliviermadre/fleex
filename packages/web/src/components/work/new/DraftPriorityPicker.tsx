/**
 * Value+onChange priority picker for the new-task draft, matching the Context
 * priority picker (PriorityPickerPopover): a PriorityIndicator trigger opening a
 * popover of priorities, bound to a draft value rather than a ticket.
 */
import type { TicketPriority } from '@fleex/shared';
import { TICKET_PRIORITIES } from '@fleex/shared';
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import { PriorityIndicator, PRIORITY_LABELS } from '../../tickets/PriorityIndicator';

// High → none reads most-important-first in the menu.
const ORDER: TicketPriority[] = [...TICKET_PRIORITIES].reverse() as TicketPriority[];

export function DraftPriorityPicker({
  value,
  onChange,
}: {
  value: TicketPriority;
  onChange: (p: TicketPriority) => void;
}) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        title={`Priority: ${PRIORITY_LABELS[value]} — click to change`}
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[12px] transition-opacity hover:opacity-70"
      >
        <PriorityIndicator priority={value} size="md" />
        <span className="text-[var(--theme-text-secondary)]">{PRIORITY_LABELS[value]}</span>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[160px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {ORDER.map((p) => (
              <button
                key={p}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--theme-bg-hover)]',
                  p === value ? 'bg-[var(--theme-bg-hover)]' : '',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(p);
                  setOpen(false);
                }}
              >
                <PriorityIndicator priority={p} />
                <span className="text-xs text-[var(--theme-text-secondary)]">{PRIORITY_LABELS[p]}</span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
