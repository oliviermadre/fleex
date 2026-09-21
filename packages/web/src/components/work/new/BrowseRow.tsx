import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

/**
 * The one row shape of the new-task browse screens: a glyph, a title over an
 * optional mono meta line, optional chips, and a trailing label (a shortcut, an
 * age). Sources, issues and pull requests all use it, so the screens read as one.
 */
export function BrowseRow({
  glyph,
  title,
  hint,
  meta,
  chips,
  trailing,
  active = false,
  onClick,
  onMouseEnter,
  rowRef,
  ...rest
}: {
  glyph: ReactNode;
  title: string;
  /** Quiet text right after the title (a count, on a source row). */
  hint?: string;
  meta?: ReactNode;
  chips?: ReactNode;
  trailing?: ReactNode;
  active?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  rowRef?: (el: HTMLButtonElement | null) => void;
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onKeyDown' | 'aria-selected' | 'role' | 'tabIndex' | 'title'>) {
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      data-active={active || undefined}
      className={cn(
        'group flex w-full items-center gap-3.5 rounded-[9px] p-3 text-left outline-none transition-colors',
        'hover:bg-[var(--theme-bg-hover)] focus-visible:bg-[var(--theme-accent-muted)]',
        active && 'bg-[var(--theme-accent-muted)] hover:bg-[var(--theme-accent-muted)]',
      )}
      {...rest}
    >
      <span
        className={cn(
          'flex w-[18px] shrink-0 justify-center text-[var(--theme-text-muted)] group-focus-visible:text-[var(--theme-accent)]',
          active && 'text-[var(--theme-accent)]',
        )}
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] text-[var(--theme-text-primary)]">
          {title}
          {hint && <span className="ml-2 text-[12.5px] text-[var(--theme-text-muted)]">{hint}</span>}
        </span>
        {meta && <span className="mt-1 block truncate font-mono text-[11.5px] text-[var(--theme-text-muted)]">{meta}</span>}
      </span>
      {chips}
      {trailing && <span className="shrink-0 font-mono text-[11.5px] text-[var(--theme-text-muted)]">{trailing}</span>}
    </button>
  );
}

export function RowChip({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md border border-[var(--theme-border-input)] px-1.5 py-0.5 font-mono text-[11px]',
        dashed ? 'border-dashed text-[var(--theme-text-muted)]' : 'text-[var(--theme-text-secondary)]',
      )}
    >
      {children}
    </span>
  );
}

/** Keyboard hint, as in the footers: `↑ ↓ move`. */
export function Keys({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="min-w-[20px] rounded-[5px] bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-center font-mono text-[11px] text-[var(--theme-text-secondary)]"
        >
          {k}
        </kbd>
      ))}
      {label}
    </span>
  );
}

/* Glyphs: stroke icons in the app's 16-unit grid, inheriting the row's colour. */
const icon = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function IssueGlyph() {
  return (
    <svg {...icon} aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PullRequestGlyph() {
  return (
    <svg {...icon} aria-hidden>
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M4 5.25v5.5M12 10.75V7a2.5 2.5 0 0 0-2.5-2.5H8" />
      <path d="M9.5 2.75 7.75 4.5 9.5 6.25" />
    </svg>
  );
}

export function SlackGlyph() {
  return (
    <svg {...icon} aria-hidden>
      <path d="M8 1.75 14.25 8 8 14.25 1.75 8Z" />
      <path d="M8 5.25 10.75 8 8 10.75 5.25 8Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
