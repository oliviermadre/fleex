import { useEffect, useRef, useState } from 'react';
import type { PrCiDetail, PrCiSummary, PrMergeMethod } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { getPrBadgeClasses, prHue } from '../../lib/prBadgeStyle';
import { prCiRef } from '../../lib/prRef';
import { ciHue, ciLabel, ciTooltip, type ChipCiStatus } from '../../lib/prCi';
import { tintClasses } from '../../lib/tints';
import { usePrCi } from '../../hooks/usePrCi';
import { FloatingPortal, usePopover } from '../../hooks/usePopover';
import { usePrCiStore } from '../../stores/prCiStore';
import { useToastStore } from '../../stores/toastStore';
import { PrCiMenu } from './PrCiMenu';
import { PrMergeConfirm } from './PrMergeConfirm';

/**
 * The single, shared GitHub Pull Request chip used everywhere in the app
 * (kanban cards, ticket sidebar, Work view, Focus modal, repository dashboard,
 * timeline). Left segment: a pill coloured by PR state (open=green,
 * merged=purple, closed=red, draft=gray) opening the PR on GitHub. Right
 * segment, for open PRs only: the live CI status, opening a menu with every
 * check and the merge actions. State and CI come from the shared
 * `prCiStore`, so every chip for the same PR stays in step; `pr.state` is
 * only the fallback until the store answers. `pr` is typed structurally so
 * PullRequest, DashboardPullRequest and inline link objects all fit.
 */
interface Props {
  org: string;
  name: string;
  pr: { number: number; state: 'open' | 'merged' | 'closed'; isDraft?: boolean; title?: string };
  /** Explicit link target; defaults to the reconstructed github.com/<org>/<name>/pull/<number>. */
  href?: string;
  className?: string;
  /** `compact` drops the CI label (it moves to the tooltip): for narrow kanban cards. */
  variant?: 'full' | 'compact';
  /** Escape hatch: false renders the plain state pill with no CI segment. */
  showCi?: boolean;
}

/** Retries while GitHub is still computing mergeability, with the menu open. */
const MERGEABILITY_RETRY_MS = 3_000;
const MERGEABILITY_MAX_RETRIES = 3;

export function PrBadge({ org, name, pr, href, className, variant = 'full', showCi = true }: Props) {
  const url = href ?? `https://github.com/${org}/${name}/pull/${pr.number}`;
  // No org means a ref we can't resolve on GitHub: plain pill.
  const ref = showCi && org ? prCiRef(org, name, pr.number) : null;
  const { summary, error } = usePrCi(ref);

  const state = summary ? (summary.state.toLowerCase() as Props['pr']['state']) : pr.state;
  const isDraft = summary ? summary.isDraft : pr.isDraft;
  const withCi = ref !== null && state === 'open';

  const pill = (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={pr.title}
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors',
        getPrBadgeClasses({ state, isDraft }),
        withCi ? 'rounded-r-none' : className,
      )}
    >
      <PrIcon />
      {name}#{pr.number}
    </a>
  );

  if (!withCi) return pill;

  const ciStatus: ChipCiStatus = summary ? summary.ciStatus : error ? 'error' : 'loading';
  return (
    <span className={cn('inline-flex flex-shrink-0 items-stretch', className)}>
      {pill}
      <PrCiSegment
        prRef={ref}
        label={`${name}#${pr.number}`}
        prUrl={url}
        status={ciStatus}
        // Same outline as the state pill, so both segments read as one chip.
        borderColor={tintClasses(prHue({ state, isDraft })).borderColor}
        summary={summary}
        error={error}
        variant={variant}
      />
    </span>
  );
}

/** GitHub's pull-request glyph, shared by every PR chip. */
export function PrIcon() {
  return (
    <svg aria-hidden width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function PrCiSegment({ prRef, label, prUrl, status, borderColor, summary, error, variant }: {
  prRef: string;
  label: string;
  prUrl: string;
  status: ChipCiStatus;
  borderColor: string;
  summary?: PrCiSummary;
  error?: string;
  variant: 'full' | 'compact';
}) {
  const detail = usePrCiStore((s) => s.details[prRef]);
  const loadDetail = usePrCiStore((s) => s.loadDetail);
  const merge = usePrCiStore((s) => s.merge);
  const addToast = useToastStore((s) => s.addToast);
  const retries = useRef(0);

  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-start',
    maxHeight: 480,
    onOpenChange: (next) => {
      // Opening always refreshes: the cached detail shows meanwhile.
      if (next) {
        retries.current = 0;
        void loadDetail(prRef);
      }
    },
  });

  // GitHub computes mergeability lazily: ask again shortly while the menu is open.
  const unknown = detail?.data && (detail.data.mergeable === 'UNKNOWN' || detail.data.mergeStateStatus === 'UNKNOWN');
  useEffect(() => {
    if (!open || !unknown || detail?.loading || retries.current >= MERGEABILITY_MAX_RETRIES) return;
    const timer = setTimeout(() => {
      retries.current += 1;
      void loadDetail(prRef);
    }, MERGEABILITY_RETRY_MS);
    return () => clearTimeout(timer);
  }, [open, unknown, detail?.loading, loadDetail, prRef]);

  const [confirm, setConfirm] = useState<{ method: PrMergeMethod; detail: PrCiDetail } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const openUrl = (url: string) => {
    window.open(url, '_blank');
    setOpen(false);
  };

  const startMerge = (method: PrMergeMethod) => {
    if (!detail?.data) return;
    setOpen(false);
    setMergeError(null);
    setConfirm({ method, detail: detail.data });
  };

  const confirmMerge = async () => {
    if (!confirm) return;
    setBusy(true);
    setMergeError(null);
    try {
      await merge(prRef, confirm.method, confirm.detail.headSha);
      addToast('success', `${label} merged (${confirm.method})`);
      setConfirm(null);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hue = ciHue(status);
  const text = ciLabel(status);
  const counts = summary ? ciTooltip(summary.counts) : '';
  const tooltip = status === 'error' ? `${text} — ${error ?? 'unknown error'}` : [text, counts].filter(Boolean).join(' · ');

  return (
    // The chip often sits inside a clickable, draggable parent (kanban card,
    // dashboard row): nothing in here — portals included — may reach it.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        ref={refs.setReference}
        type="button"
        draggable={false}
        title={tooltip}
        aria-label={variant === 'compact' ? text : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        {...getReferenceProps()}
        className={cn(
          'inline-flex items-center gap-1 rounded-r-md border border-l-0 bg-[var(--theme-bg-surface)] px-1.5 py-0.5 text-[10.5px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]',
          borderColor,
        )}
      >
        <span
          data-testid="pr-ci-dot"
          className={cn(
            'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
            status === 'none' ? cn('border', tintClasses(hue).borderColor) : tintClasses(hue).solid,
            (status === 'running' || status === 'loading') && 'animate-pulse',
          )}
        />
        {variant === 'full' && <span>{text}</span>}
        <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden className="shrink-0 opacity-70">
          <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
        </svg>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9999] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] shadow-lg"
          >
            <PrCiMenu
              prUrl={prUrl}
              summary={summary}
              detail={detail}
              onRetry={() => void loadDetail(prRef)}
              onOpenUrl={openUrl}
              onMerge={startMerge}
            />
          </div>
        </FloatingPortal>
      )}

      {confirm && (
        <PrMergeConfirm
          method={confirm.method}
          label={label}
          detail={confirm.detail}
          busy={busy}
          error={mergeError}
          onConfirm={() => void confirmMerge()}
          onCancel={() => {
            if (busy) return;
            setConfirm(null);
          }}
        />
      )}
    </span>
  );
}

