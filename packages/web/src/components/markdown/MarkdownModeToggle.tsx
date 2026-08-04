import { cn } from '../../lib/cn';
import type { MarkdownMode } from './useMarkdownMode';

const ICONS: Record<MarkdownMode, React.ReactNode> = {
  write: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z" />
    </svg>
  ),
  preview: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  split: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M8 3v10" />
    </svg>
  ),
};

const LABELS: Record<MarkdownMode, string> = {
  write: 'Write',
  preview: 'Preview',
  split: 'Split',
};

interface MarkdownModeToggleProps {
  mode: MarkdownMode;
  onChange: (mode: MarkdownMode) => void;
  /** Hidden on narrow viewports, where a side-by-side split is unreadable. */
  allowSplit?: boolean;
  /**
   * Collapse to the active mode alone until an ancestor `.group` is hovered.
   * For the overlaid toggle of the `panel` variant: the chip sits *on* the
   * text, so at rest it shrinks to a third of its width instead of covering
   * a whole line.
   *
   * Guarded by `@media (hover: hover)` — on a touch screen nothing ever
   * hovers, and a toggle collapsed to its active mode would be a dead end.
   */
  collapsible?: boolean;
  className?: string;
}

/**
 * Compact three-state segmented control — the single control through which
 * every markdown surface in Fleex switches between raw text and its rendering.
 */
export function MarkdownModeToggle({
  mode,
  onChange,
  allowSplit = true,
  collapsible = false,
  className,
}: MarkdownModeToggleProps) {
  const modes: MarkdownMode[] = allowSplit ? ['write', 'preview', 'split'] : ['write', 'preview'];

  return (
    <div
      role="group"
      aria-label="Markdown view mode"
      className={cn(
        'flex items-center gap-0.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]/80 p-0.5 backdrop-blur-sm',
        className,
      )}
    >
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          aria-label={LABELS[m]}
          aria-pressed={mode === m}
          title={`${LABELS[m]} (⌘⇧P to cycle)`}
          // Keep focus in the textarea: switching view must never move the caret.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(m)}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors',
            mode === m
              ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
              : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]',
            // Pure CSS: no state, no measurement, no re-render on hover.
            // `group-hover:flex` outranks the hidden rule on specificity, so
            // the source order of the two utilities doesn't matter.
            collapsible && mode !== m && '[@media(hover:hover)]:hidden group-hover:flex',
          )}
        >
          {ICONS[m]}
        </button>
      ))}
    </div>
  );
}
