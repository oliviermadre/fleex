import { useEffect, useLayoutEffect, useRef } from 'react';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';

/** True for what keeps its own keys: a field being typed in. */
export const editable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};
/** True while something is opened over the sheet (a dialog, a popover): the keys are for it. */
export const covered = (): boolean => !!document.querySelector('[data-overlay-top], [data-floating-ui-portal]');
export const KBD = 'rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-1 font-mono text-[10px] text-[var(--theme-text-secondary)]';

/**
 * What the Factory opens over its floor: a sheet that slides up from the bottom, over the floor and its console, under
 * the app's top bar. A ticket (the workbench), a machine or the floor's own figures open in one; nothing of the
 * Factory opens in a side panel, which would take the floor's width. `fit` is for what has little to show: the sheet
 * is then only as high as its content, and narrower. Escape and a click outside go back to the floor.
 */
export function FactorySheet({ label, onClose, bar, children, fit, onKey }: {
  label: string; onClose: () => void;
  /** What follows the way back in the sheet's top bar. */
  bar?: React.ReactNode; children: React.ReactNode;
  /** A width in pixels: the sheet is that wide at most, centred, and as high as what it holds. */
  fit?: number;
  /** The sheet's other keys (it handles Escape itself). Not called from a field, nor while something is opened over it. */
  onKey?: (e: KeyboardEvent) => void;
}) {
  const sheet = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const n = sheet.current;
    if (!n || typeof n.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    n.animate([{ transform: 'translateY(38%)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.85,.25,1)' });
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (covered()) return;
      /* a field keeps its keys, Escape among them */
      if (editable(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); } else onKey?.(e);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [onClose, onKey]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" style={{ top: 'var(--header-height)' }} onClick={onClose} aria-hidden="true" />
      <section ref={sheet} aria-label={label}
        className={cn('fixed bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] shadow-2xl', fit ? 'inset-x-0 mx-auto' : 'inset-x-2.5')}
        style={fit ? { width: `min(${fit}px, calc(100% - 20px))`, maxHeight: 'calc(100% - var(--header-height) - 10px)' } : { top: 'calc(var(--header-height) + 10px)' }}>
        <div className="relative flex min-h-10 flex-none items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2.5 py-1">
          <span className="absolute left-1/2 top-1 h-1 w-11 -translate-x-1/2 rounded-full bg-[var(--theme-border-input)]" aria-hidden="true" />
          <Button size="sm" variant="ghost" onClick={onClose}>Floor <kbd className={KBD}>Esc</kbd></Button>
          {bar}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    </>
  );
}
