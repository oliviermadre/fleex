import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { cn } from '../../lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  /** Stacking class of the backdrop (default `z-50`). */
  zIndexClass?: string;
  /** Drawn behind the dialog, over its footprint (e.g. a pile of cards peeking below it). */
  underlay?: React.ReactNode;
  /**
   * `glass`: the dialog stands over a lighter backdrop that blurs nothing, so the page under it stays in sight
   * round it. For a dialog opened over something one keeps an eye on. The dialog itself is opaque: it used to
   * blur what was behind it, and over a page that moves (the Factory's floor, painted anew many times a second)
   * that blur is worked out again at each of those frames, over the whole dialog. Measured with a ticket open
   * over the floor, it doubled what Fleex spent.
   */
  variant?: 'solid' | 'glass';
  /** No padding and clipped corners: the content brings its own layout (a bar, columns that scroll). */
  flush?: boolean;
  /**
   * For a dialog that holds a working surface (fields, a composer, things that open over it): Escape pressed in a
   * field stays in the field, and Escape does nothing while another overlay is opened over this dialog.
   */
  guardEscape?: boolean;
}

/** What the glass variant adds to the dialog: its surface, lit along its top edge, and a deeper shadow. Nothing is blurred (see `variant`). */
const GLASS: React.CSSProperties = {
  background: 'var(--theme-bg-surface)',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 24px 64px rgba(0, 0, 0, 0.5)',
};
const inField = (el: HTMLElement | null): boolean => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export function Modal({ open, onClose, children, className, maxWidth = 'max-w-lg', zIndexClass = 'z-50', underlay, variant = 'solid', flush = false, guardEscape = false }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  // Selecting the text of a dialog and releasing past its edge used to close it.
  const dismiss = useBackdropDismiss(backdropRef, onClose);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // A floating terminal stacked over the modal keeps its Escape (Claude Code's interrupt).
        if ((e.target as HTMLElement | null)?.closest?.('[data-floating-panel]')) return;
        // An open @-mention menu inside the modal takes Escape first: it closes the menu, not the modal.
        if (backdropRef.current?.querySelector('[data-mention-menu]')) return;
        // A popover opened from the dialog (a filter drop-down, a picker) lives in a floating portal and closes itself on Escape.
        if ((e.target as HTMLElement | null)?.closest?.('[data-floating-ui-portal]')) return;
        // A zone of the dialog that folds itself on Escape (e.g. a composer opened on demand) keeps it.
        if ((e.target as HTMLElement | null)?.closest?.('[data-modal-escape-local]')) return;
        if (guardEscape) {
          if (inField(e.target as HTMLElement | null)) return;
          // Something opened over this dialog (another dialog, a reader) is the one Escape is for.
          const tops = document.querySelectorAll('[data-overlay-top]');
          if (tops[tops.length - 1] !== backdropRef.current) return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose, guardEscape]);

  if (!open) return null;

  const glass = variant === 'glass';
  const dialog = (
    <div
      className={cn(
        `w-full ${maxWidth} rounded-xl border`,
        glass ? 'border-[var(--theme-border-input)]' : 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)] shadow-2xl',
        flush ? 'overflow-hidden' : 'p-6',
        underlay != null && 'relative',
        className
      )}
      style={glass ? GLASS : undefined}
    >
      {children}
    </div>
  );

  return createPortal(
    <div
      ref={backdropRef}
      data-overlay-top
      className={cn('fixed inset-0 flex items-center justify-center', glass ? 'bg-black/35' : 'bg-black/60 backdrop-blur-sm', zIndexClass)}
      {...dismiss}
    >
      {underlay != null ? <div className={cn('relative w-full', maxWidth)}>{underlay}{dialog}</div> : dialog}
    </div>,
    document.body
  );
}
