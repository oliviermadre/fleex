import { useCallback, useMemo, useRef, useState } from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  arrow as arrowMiddleware,
  useClick,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  safePolygon,
  type Placement,
  type UseRoleProps,
  type UseFloatingReturn,
  type UseInteractionsReturn,
} from '@floating-ui/react';
import type { CSSProperties, RefObject } from 'react';

// Re-export so call-sites import everything from one place.
export { FloatingPortal, FloatingFocusManager } from '@floating-ui/react';

const VIEWPORT_PADDING = 8;
/** Keeps a tooltip's arrow clear of the bubble's rounded corners. */
const ARROW_PADDING = 6;

interface PopoverReturn {
  open: boolean;
  setOpen: (next: boolean) => void;
  refs: UseFloatingReturn['refs'];
  floatingStyles: CSSProperties;
  context: UseFloatingReturn['context'];
  getReferenceProps: UseInteractionsReturn['getReferenceProps'];
  getFloatingProps: UseInteractionsReturn['getFloatingProps'];
}

interface ContextMenuPopoverReturn {
  open: boolean;
  openAt: (x: number, y: number) => void;
  close: () => void;
  refs: UseFloatingReturn['refs'];
  floatingStyles: CSSProperties;
  context: UseFloatingReturn['context'];
  getFloatingProps: UseInteractionsReturn['getFloatingProps'];
}

interface PopoverOptions {
  /** Preferred placement; flips/shifts automatically to stay in the viewport. */
  placement?: Placement;
  /** Gap in px between the trigger and the floating element. Default 4. */
  gap?: number;
  /** ARIA role for the floating element. Default 'menu'. Pass null to skip. */
  role?: UseRoleProps['role'] | null;
  /** Controlled open state. Omit to let the hook own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Toggle the popover when the trigger is clicked. Default true. Set false
   * for inputs that drive `open` themselves (e.g. an autocomplete that opens
   * on typing) — pass `open`/`onOpenChange` instead.
   */
  enableClick?: boolean;
  /** Close on outside-click / Escape. Default true. */
  enableDismiss?: boolean;
  /**
   * Explicit height cap in px. The popover is always bounded by the available
   * viewport space; pass this to additionally clamp it (effective max-height is
   * `min(maxHeight, available space)`), so it never sprawls on tall windows.
   */
  maxHeight?: number;
}

/**
 * Standard viewport-aware popover positioning, shared by every dropdown /
 * menu / picker in the app. Wraps Floating UI with the project's defaults:
 * `offset` (gap), `flip` (bascule au-dessus si pas de place en bas),
 * `shift` (décale pour rester dans le viewport — gère le bord droit) and
 * `size` (cap la hauteur à l'espace disponible + scroll interne).
 *
 * Replaces the old `getBoundingClientRect()` + `style={{left,top}}` +
 * `useClickOutside` trio. Dismiss handles outside-click AND Escape.
 *
 * Render the floating content inside `<FloatingPortal>` with
 * `ref={refs.setFloating}` / `style={floatingStyles}` / `{...getFloatingProps()}`,
 * and attach the trigger with `ref={refs.setReference}` / `{...getReferenceProps()}`.
 */
export function usePopover({
  placement = 'bottom-start',
  gap = 4,
  role = 'menu',
  open: controlledOpen,
  onOpenChange,
  enableClick = true,
  enableDismiss = true,
  maxHeight,
}: PopoverOptions = {}): PopoverReturn {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const middleware = useMemo(
    () => [
      offset(gap),
      flip({ padding: VIEWPORT_PADDING }),
      shift({ padding: VIEWPORT_PADDING }),
      size({
        padding: VIEWPORT_PADDING,
        apply({ availableHeight, elements }) {
          const capped = maxHeight != null ? Math.min(availableHeight, maxHeight) : availableHeight;
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, capped)}px`,
            overflowY: 'auto',
          });
        },
      }),
    ],
    [gap, maxHeight],
  );

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware,
  });

  const click = useClick(context, { enabled: enableClick });
  const dismiss = useDismiss(context, { enabled: enableDismiss });
  const roleInteraction = useRole(context, { role: role ?? undefined, enabled: role !== null });

  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, roleInteraction]);

  return { open, setOpen, refs, floatingStyles, context, getReferenceProps, getFloatingProps };
}

/**
 * Same viewport-aware positioning, anchored to a mouse point instead of an
 * element — for right-click context menus. Call `openAt(x, y)` from the
 * `onContextMenu` handler; the menu opens at the cursor and flips/shifts to
 * stay on screen. The trigger does NOT receive reference props (the anchor is
 * a virtual point), only the floating element gets `getFloatingProps()`.
 */
export function useContextMenuPopover({
  placement = 'bottom-start',
  role = 'menu',
}: Pick<PopoverOptions, 'placement' | 'role'> = {}): ContextMenuPopoverReturn {
  const [open, setOpen] = useState(false);

  const middleware = useMemo(
    () => [
      offset(0),
      flip({ padding: VIEWPORT_PADDING }),
      shift({ padding: VIEWPORT_PADDING }),
      size({
        padding: VIEWPORT_PADDING,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, availableHeight)}px`,
            overflowY: 'auto',
          });
        },
      }),
    ],
    [],
  );

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware,
  });

  const dismiss = useDismiss(context);
  const roleInteraction = useRole(context, { role: role ?? undefined, enabled: role !== null });
  const { getFloatingProps } = useInteractions([dismiss, roleInteraction]);

  const openAt = useCallback(
    (x: number, y: number) => {
      refs.setPositionReference({
        getBoundingClientRect: () => ({
          x,
          y,
          top: y,
          left: x,
          right: x,
          bottom: y,
          width: 0,
          height: 0,
        }),
      });
      setOpen(true);
    },
    [refs],
  );

  const close = useCallback(() => setOpen(false), []);

  return { open, openAt, close, refs, floatingStyles, context, getFloatingProps };
}

interface TooltipReturn {
  open: boolean;
  refs: UseFloatingReturn['refs'];
  floatingStyles: CSSProperties;
  context: UseFloatingReturn['context'];
  /** Attach to `<FloatingArrow ref={arrowRef} …>` when the `arrow` option is on. */
  arrowRef: RefObject<SVGSVGElement | null>;
  getReferenceProps: UseInteractionsReturn['getReferenceProps'];
  getFloatingProps: UseInteractionsReturn['getFloatingProps'];
}

interface TooltipOptions extends Pick<PopoverOptions, 'placement' | 'gap'> {
  /**
   * Point at the trigger with an arrow. Enables the arrow middleware, so the
   * arrow keeps pointing at the trigger even when `shift` slides the bubble to
   * stay in the viewport. Render `<FloatingArrow ref={arrowRef} context={context} />`
   * inside the floating element. Default false.
   */
  arrow?: boolean;
  /**
   * Whether the pointer may travel onto the tooltip (default true): it then
   * stays open along the way, and a press on the trigger leaves it open.
   * Pass false for a label-only tooltip that is never interacted with — it then
   * closes the instant the pointer leaves the trigger or presses it, like a
   * native `title`.
   */
  interactive?: boolean;
}

/**
 * Hover/focus tooltip with the same viewport-aware flip/shift, so a tooltip
 * near a screen edge stays fully visible. Defaults to `top` placement.
 */
export function useTooltip({
  placement = 'top',
  gap = 6,
  arrow = false,
  interactive = true,
}: TooltipOptions = {}): TooltipReturn {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement | null>(null);

  const middleware = useMemo(
    () => [
      offset(gap),
      flip({ padding: VIEWPORT_PADDING }),
      shift({ padding: VIEWPORT_PADDING }),
      // Last: it reads the final position, after flip/shift have settled.
      ...(arrow ? [arrowMiddleware({ element: arrowRef, padding: ARROW_PADDING })] : []),
    ],
    [gap, arrow],
  );

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware,
  });

  const hover = useHover(context, { move: false, handleClose: interactive ? safePolygon() : null });
  const focus = useFocus(context);
  const dismiss = useDismiss(context, { referencePress: !interactive });
  const roleInteraction = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, roleInteraction]);

  return { open, refs, floatingStyles, context, arrowRef, getReferenceProps, getFloatingProps };
}
