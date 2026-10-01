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
}

export function Modal({ open, onClose, children, className, maxWidth = 'max-w-lg', zIndexClass = 'z-50', underlay }: ModalProps) {
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
        // A zone of the dialog that folds itself on Escape (e.g. a composer opened on demand) keeps it.
        if ((e.target as HTMLElement | null)?.closest?.('[data-modal-escape-local]')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const dialog = (
    <div
      className={cn(
        `w-full ${maxWidth} rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-6 shadow-2xl`,
        underlay != null && 'relative',
        className
      )}
    >
      {children}
    </div>
  );

  return createPortal(
    <div
      ref={backdropRef}
      data-overlay-top
      className={cn('fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm', zIndexClass)}
      {...dismiss}
    >
      {underlay != null ? <div className={cn('relative w-full', maxWidth)}>{underlay}{dialog}</div> : dialog}
    </div>,
    document.body
  );
}
