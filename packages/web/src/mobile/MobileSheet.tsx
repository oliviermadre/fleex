import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SHEET_EASING, SHEET_MS, useSheetDrag } from './useSheetDrag';

/**
 * Shared bottom sheet for the mobile shell, behaving like a native iOS sheet:
 * it slides up on open, follows the finger when dragged down and flies out
 * (or springs back) on release; tapping the backdrop closes it with the same
 * animation. Sits above the floating bar (z-50), below the assistant's command
 * confirmation (z-60).
 */
export function MobileSheet({
  title,
  onClose,
  children,
  grabber = false,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  grabber?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  // Mount closed, then flip on the next frame so the slide-up transition runs.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    setTimeout(onClose, SHEET_MS);
  }, [onClose]);

  const { dy, dragging, touchProps } = useSheetDrag(dismiss, () => panelRef.current?.scrollTop ?? 0);

  const progress = shown ? Math.max(0, 1 - dy / 600) : 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{
        background: `rgba(0,0,0,${0.5 * progress})`,
        transition: dragging ? 'none' : `background ${SHEET_MS}ms ${SHEET_EASING}`,
      }}
      onClick={dismiss}
    >
      <div
        ref={panelRef}
        {...touchProps}
        className="max-h-[80dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
          transform: shown ? `translateY(${dy}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : `transform ${SHEET_MS}ms ${SHEET_EASING}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {grabber && (
          <div className="mx-auto -mt-2 mb-2 flex h-6 w-16 items-center justify-center" aria-hidden>
            <span className="block h-[5px] w-9 rounded-full bg-[var(--theme-border-input)]" />
          </div>
        )}
        {title && (
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
            {title}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

/** Option row used by the picker sheets (status, boards, filters). */
export function SheetOption({
  label,
  active,
  onClick,
  leading,
}: {
  label: ReactNode;
  active?: boolean;
  onClick: () => void;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] active:bg-[var(--theme-bg-hover)] ${
        active ? 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]'
      }`}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <span className="text-[var(--theme-accent)]">✓</span>}
    </button>
  );
}
