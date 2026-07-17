import { groupHue } from './grouping';
import { tintClasses } from '../../lib/tints';
import { cn } from '../../lib/cn';

interface Props {
  /** Status id — drives the tint hue (doing=blue, reviewing=purple…). */
  groupKey: string;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Sticky group band for the List/Focus cockpit.
 *
 * Pass 8 (NaS): the standalone status "pill" is gone — the ENTIRE band now
 * takes the status background colour and the label sits on it in UPPERCASE
 * using the contrasting bi-tone text colour. Both come from the theme-aware
 * tint vars (`--tint-{hue}-bg` / `--tint-{hue}-text`), which flip with
 * light/dark, so band-bg ↔ label-text always stay a legible pair. The chevron
 * and count inherit that same tint text via `currentColor`.
 */
export function ListFocusGroupHeader({ groupKey, label, count, collapsed, onToggle }: Props) {
  const hue = groupHue(groupKey);
  const tc = hue ? tintClasses(hue) : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'sticky top-0 z-10 flex w-full items-center gap-2 border-b px-3 py-1.5 text-left transition-colors',
        tc
          ? cn(tc.bg, tc.borderColor, tc.text, tc.hoverBg)
          : 'border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('transition-transform', collapsed ? '' : 'rotate-90')}
      >
        <polyline points="6,4 10,8 6,12" />
      </svg>
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      <span className="text-[10px] tabular-nums opacity-60">{count}</span>
    </button>
  );
}
