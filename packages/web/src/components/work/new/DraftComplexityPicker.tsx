/**
 * Value+onChange complexity picker for the new-task draft, matching
 * `ComplexityPickerPopover` but bound to a draft value rather than a ticket.
 */
import type { TicketComplexity } from '@fleex/shared';
import { usePopover, FloatingPortal, FloatingFocusManager } from '../../../hooks/usePopover';
import { ComplexityBadge, complexityDescription } from '../../tickets/ComplexityBadge';
import { ComplexityGrid, complexityInitialFocus, useComplexityCellRefs } from '../../tickets/ComplexityGrid';

export function DraftComplexityPicker({
  value,
  onChange,
}: {
  value: TicketComplexity | null;
  onChange: (c: TicketComplexity | null) => void;
}) {
  const { open, setOpen, refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover();
  const cellRefs = useComplexityCellRefs();

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        title={`Complexity: ${complexityDescription(value)} — click to change`}
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[12px] transition-opacity hover:opacity-70"
      >
        <ComplexityBadge complexity={value} />
        <span className="text-[var(--theme-text-secondary)]">{value === null ? 'Complexity' : complexityDescription(value)}</span>
      </button>

      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={complexityInitialFocus(value)}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="z-50 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] shadow-xl"
            >
              <ComplexityGrid
                value={value}
                onPick={(c) => {
                  onChange(c);
                  setOpen(false);
                }}
                cellRefs={cellRefs}
              />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
