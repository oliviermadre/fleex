/**
 * The shell of every Timeline popover (annotation reader / list / composer,
 * todo marks): a portal at fixed coordinates above its anchor (below when there
 * is no room), so the drawer's overflow never clips it. Échap or a click
 * outside closes it — a click on its own anchor is left to the anchor, which
 * toggles (pin / unpin). Optional hover handlers let a hover-opened popover
 * stay open while the cursor travels from its anchor into it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a reader / list needs to be hover-opened and to toggle on its anchor. */
export interface PopoverHover {
  /** `data-timeline-node` of the anchor: a click on it is not a click outside. */
  anchorNode?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function Popover({
  anchor,
  width,
  onClose,
  label,
  children,
  hover,
}: {
  anchor: AnchorRect;
  width: number;
  onClose: () => void;
  label: string;
  children: ReactNode;
  hover?: PopoverHover;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Above the anchor when there is room (the drawer sits at the bottom), else below.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, vw - width - 8));
    let top = anchor.top - h - 8;
    if (top < 8) top = Math.min(anchor.top + anchor.height + 8, vh - h - 8);
    setPos({ left, top: Math.max(8, top) });
  }, [anchor, width, children]);

  const anchorNode = hover?.anchorNode;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!ref.current || ref.current.contains(target)) return;
      // The anchor's own click decides (pin / unpin): closing here would let it reopen us.
      if (anchorNode && target.closest?.('[data-timeline-node]')?.getAttribute('data-timeline-node') === anchorNode) return;
      onClose();
    };
    // Next tick: the click that opened us must not close us.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose, anchorNode]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      onMouseEnter={hover?.onMouseEnter}
      onMouseLeave={hover?.onMouseLeave}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed z-50 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-3 shadow-2xl"
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

