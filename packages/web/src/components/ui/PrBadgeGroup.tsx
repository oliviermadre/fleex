import { cn } from '../../lib/cn';
import { prHue } from '../../lib/prBadgeStyle';
import { ciHue, prGroupTooltip, worstPrStatus, type PrGroupEntry } from '../../lib/prCi';
import { comparePrs, prCiRef, type LinkedPr } from '../../lib/prRef';
import { tintClasses } from '../../lib/tints';
import { usePrCiMany } from '../../hooks/usePrCi';
import { FloatingPortal, usePopover } from '../../hooks/usePopover';
import { PrBadge, PrIcon } from './PrBadge';

/** From this many PRs, every place folds its chips into one summary chip. */
export const PR_SUMMARY_MIN = 3;

/**
 * Every PR of a ticket, at the density its place allows:
 * - up to 2 PRs, one chip each: `full` (state + CI label) for detail views,
 *   `card` compact (CI as a dot) for cards;
 * - from PR_SUMMARY_MIN PRs, wherever it is, a single summary chip —
 *   "(dot) 6 PR", dot = worst status — opening a dropdown of the compact
 *   chips, each with its own CI menu.
 * Always in org/repo then PR-number order. Renders a fragment: the caller's flex container lays the chips out.
 */
export function PrBadgeGroup({ prs: unsorted, density }: { prs: LinkedPr[]; density: 'full' | 'card' }) {
  if (unsorted.length === 0) return null;
  const prs = [...unsorted].sort(comparePrs);
  if (prs.length >= PR_SUMMARY_MIN) return <PrSummaryChip prs={prs} />;
  return <>{prs.map((pr, i) => <LinkedPrBadge key={`${pr.title}-${i}`} pr={pr} variant={density === 'full' ? 'full' : 'compact'} />)}</>;
}

function LinkedPrBadge({ pr, variant }: { pr: LinkedPr; variant: 'full' | 'compact' }) {
  return (
    <PrBadge
      org={pr.org}
      name={pr.name}
      pr={{ number: pr.number, state: pr.state ?? 'open', isDraft: pr.isDraft, title: pr.title }}
      href={pr.href}
      variant={variant}
    />
  );
}

function PrSummaryChip({ prs }: { prs: LinkedPr[] }) {
  const refs = prs.filter((pr) => pr.org).map((pr) => prCiRef(pr.org, pr.name, pr.number));
  const { summaries, errors } = usePrCiMany(refs);
  // Same reading as each chip: the store's answer, the last known state until it comes.
  const entries: PrGroupEntry[] = prs.map((pr) => {
    const fallback = pr.state ?? 'open';
    if (!pr.org) return { state: fallback, ci: 'none' };
    const ref = prCiRef(pr.org, pr.name, pr.number);
    const summary = summaries[ref];
    if (!summary) return { state: fallback, ci: errors[ref] ? 'error' : 'loading' };
    return { state: summary.state.toLowerCase() as PrGroupEntry['state'], ci: summary.ciStatus };
  });
  const worst = worstPrStatus(entries);
  const hue = !worst ? 'gray' : worst.kind === 'ci' ? ciHue(worst.status) : prHue({ state: worst.state, isDraft: false });
  const tooltip = prGroupTooltip(entries);

  // The rows' CI menus and merge dialogs are rendered from this dropdown:
  // Floating UI follows the React tree through their portals, so a press in
  // them is not an outside press and the dropdown stays open.
  const popover = usePopover({ placement: 'bottom-start', role: 'dialog', maxHeight: 360 });

  return (
    // Sits inside a clickable, draggable card: nothing in here — the portal
    // included, React bubbles through it — may reach the card.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        ref={popover.refs.setReference}
        type="button"
        draggable={false}
        title={tooltip}
        aria-label={tooltip}
        aria-expanded={popover.open}
        {...popover.getReferenceProps()}
        className={cn(
          'inline-flex flex-shrink-0 items-center gap-1 rounded-md border bg-[var(--theme-bg-surface)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]',
          tintClasses(hue).borderColor,
        )}
      >
        <span
          data-testid="pr-summary-dot"
          className={cn(
            'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
            worst?.kind === 'ci' && worst.status === 'none' ? cn('border', tintClasses(hue).borderColor) : tintClasses(hue).solid,
            worst?.kind === 'ci' && (worst.status === 'running' || worst.status === 'loading') && 'animate-pulse',
          )}
        />
        <PrIcon />
        {prs.length} PR
        <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden className="shrink-0 opacity-70">
          <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
        </svg>
      </button>

      {popover.open && (
        <FloatingPortal>
          <div
            ref={popover.refs.setFloating}
            style={popover.floatingStyles}
            {...popover.getFloatingProps()}
            className="z-[9999] flex flex-col items-start gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2 shadow-lg"
          >
            {prs.map((pr, i) => <LinkedPrBadge key={`${pr.title}-${i}`} pr={pr} variant="compact" />)}
          </div>
        </FloatingPortal>
      )}
    </span>
  );
}
