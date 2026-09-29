import { cloneElement, type ReactElement, type ReactNode, type Ref } from 'react';
import { FloatingArrow, useMergeRefs, type Placement } from '@floating-ui/react';
import { useTooltip, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

/** Room for the arrow (5px tall) plus a hair of air between it and the trigger. */
const GAP_PX = 8;

interface TooltipProps {
  /** Short text naming the trigger (kept to one line), or rich content when `interactive`. */
  label: ReactNode;
  /** Preferred side; flips/shifts on its own near the viewport edge. Default `bottom`. */
  placement?: Placement;
  /**
   * Let the pointer travel onto the bubble and click what's inside it (default
   * false). The bubble then stays open while hovered, pressing the trigger
   * leaves it open, and its content may wrap over several lines.
   */
  interactive?: boolean;
  /**
   * The trigger. It must be a single element that forwards its `ref` (any DOM
   * element does): the tooltip attaches to it directly rather than wrapping it,
   * so it adds no node to the surrounding layout.
   */
  children: ReactElement<{ ref?: Ref<HTMLElement> }>;
}

/**
 * Instant label tooltip — the replacement for a native `title`, which the
 * browser only shows after ~1s. Appears the moment the pointer enters (or the
 * keyboard focuses) the trigger, centred on it with an arrow pointing at it, and
 * goes away as soon as the pointer leaves or the trigger is pressed.
 *
 * Rendered in a portal, so an `overflow` on the trigger's container can't clip
 * it. Since it replaces `title`, give an icon-only trigger an `aria-label`.
 */
export function Tooltip({ label, placement = 'bottom', interactive = false, children }: TooltipProps) {
  const { open, refs, floatingStyles, context, arrowRef, getReferenceProps, getFloatingProps } = useTooltip({
    placement,
    gap: GAP_PX,
    arrow: true,
    interactive,
  });
  const ref = useMergeRefs([refs.setReference, children.props.ref]);

  return (
    <>
      {cloneElement(children, getReferenceProps({ ...children.props, ref }))}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={cn(
              'z-[9999] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] text-[11px] font-medium text-[var(--theme-text-primary)] shadow-lg',
              interactive ? 'px-2.5 py-2 leading-snug' : 'pointer-events-none whitespace-nowrap px-2 py-1 leading-none',
            )}
          >
            {label}
            <FloatingArrow
              ref={arrowRef}
              context={context}
              width={10}
              height={5}
              fill="var(--theme-bg-overlay)"
              stroke="var(--theme-border)"
              strokeWidth={1}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
