import type { ReactNode } from 'react';

/**
 * Shared bottom sheet for the mobile shell: backdrop `rgba(0,0,0,.5)` (tap
 * outside closes), `rounded-t-2xl` panel, safe-area padding. Sits above the
 * floating bar (z-50) and below the assistant's command confirmation (z-60).
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
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {grabber && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="mx-auto -mt-2 mb-2 block h-6 w-16"
          >
            <span className="mx-auto block h-[5px] w-9 rounded-full bg-[var(--theme-border-input)]" />
          </button>
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
