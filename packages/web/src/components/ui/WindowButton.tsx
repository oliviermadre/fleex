import type { CSSProperties } from 'react';
import { Tooltip } from './Tooltip';
import { titleBarBottom } from '../actions/terminalAnchor';

/** Gap kept around a maximized window: it never touches the edges nor hides under the desktop title bar. */
export const MAXIMIZED_MARGIN = 16;

/** A maximized window: the viewport minus the margin, below the desktop title bar. Plain insets, so it follows the app window's size. */
export function maximizedStyle(): CSSProperties {
  return { top: titleBarBottom() + MAXIMIZED_MARGIN, left: MAXIMIZED_MARGIN, right: MAXIMIZED_MARGIN, bottom: MAXIMIZED_MARGIN };
}

export const WINDOW_ICONS = {
  maximize: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  restore: <path d="M5 12h14" />,
  hide: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
} as const;

/** The Maximize / Restore tooltip, the same on every window. */
export function maximizeLabel(maximized: boolean): string {
  return maximized ? 'Restore size (double-click the bar)' : 'Maximize (double-click the bar)';
}

/** One of a window's controls: a small square button, its icon, a tooltip. */
export function WindowButton({ kind, label, onClick }: { kind: keyof typeof WINDOW_ICONS; label: string; onClick: () => void }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        data-window-button={kind}
        onClick={onClick}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {WINDOW_ICONS[kind]}
        </svg>
      </button>
    </Tooltip>
  );
}

/** A press on a button of the bar is a click, not the start of a drag or a double-click. */
export function onAButton(e: React.MouseEvent): boolean {
  return !!(e.target as HTMLElement).closest('button');
}
