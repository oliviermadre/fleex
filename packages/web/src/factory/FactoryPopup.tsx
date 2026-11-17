import { useEffect, useRef } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/cn';

/** True for what keeps its own keys: a field being typed in. */
export const editable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};
export const KBD = 'rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-1 font-mono text-[10px] text-[var(--theme-text-secondary)]';

/** How much of the window a popup takes: all of it but a margin, a large part, or only what its content needs. */
export type PopupSize = 'full' | 'large' | 'fit';
const HEIGHT: Record<PopupSize, string> = { full: 'h-[calc(100vh-56px)]', large: 'h-[min(860px,calc(100vh-96px))]', fit: 'max-h-[calc(100vh-96px)]' };

/**
 * What the Factory opens over its floor: a popup in the middle of the window, of glass (slightly translucent, and
 * blurring what is behind it) so the floor stays in sight around and under it. A ticket (the workbench), a machine and
 * the floor's own figures all open in one: nothing of the Factory opens in a side panel, which would take the floor's
 * width, nor in a sheet. It is Fleex's `Modal`, with a bar along its top. Escape and a click outside go back to the
 * floor; Escape typed in a field stays in the field, and is left to whatever is opened over the popup.
 */
export function FactoryPopup({ label, onClose, bar, children, size = 'large', maxWidth, onKey }: {
  label: string; onClose: () => void;
  /** What the bar holds, before its way out. */
  bar?: React.ReactNode; children: React.ReactNode;
  size?: PopupSize;
  /** The widest the popup gets, as a class (`max-w-…`). */
  maxWidth: string;
  /** The popup's other keys (Escape is the Modal's). Not called from a field, nor while something is opened over it. */
  onKey?: (e: KeyboardEvent) => void;
}) {
  const body = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!onKey) return;
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || editable(e.target)) return;
      const tops = document.querySelectorAll('[data-overlay-top]');
      if (tops[tops.length - 1] !== body.current?.closest('[data-overlay-top]') || document.querySelector('[data-floating-ui-portal]')) return;
      onKey(e);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [onKey]);

  return (
    <Modal open onClose={onClose} variant="glass" flush guardEscape zIndexClass="z-40" maxWidth={maxWidth} className={cn('mx-3 flex flex-col', HEIGHT[size])}>
      <section ref={body} aria-label={label} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-11 flex-none items-center gap-2 border-b border-[var(--theme-border)] px-3 py-1.5">
          {bar}
          <Button size="sm" variant="ghost" className="flex-none" onClick={onClose}>Close <kbd className={KBD}>Esc</kbd></Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    </Modal>
  );
}
