import type { PrCheck, PrCiBucket, PrCiSummary, PrMergeMethod } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { BUCKET_HUE, ciTooltip, formatCheckDuration, mergeBlockReason, mergeMethodLabel } from '../../lib/prCi';
import { tintClasses, tintSolid, tintText } from '../../lib/tints';
import type { PrCiDetailEntry } from '../../stores/prCiStore';
import { Spinner } from './Spinner';

/** Rows shown before handing over to GitHub's Checks tab. */
export const MAX_CHECK_ROWS = 20;

const BUCKET_GLYPH: Record<PrCiBucket, string> = {
  pass: '✓', fail: '✕', running: '◌', pending: '◌', cancel: '⊘', skip: '–',
};

interface Props {
  prUrl: string;
  summary?: PrCiSummary;
  detail?: PrCiDetailEntry;
  onRetry: () => void;
  onOpenUrl: (url: string) => void;
  onMerge: (method: PrMergeMethod) => void;
}

/** Body of the CI segment's dropdown: checks first, then the merge actions. */
export function PrCiMenu({ prUrl, summary, detail, onRetry, onOpenUrl, onMerge }: Props) {
  const data = detail?.data;
  const counts = data?.counts ?? summary?.counts ?? {};
  const countsLine = ciTooltip(counts);
  const checksUrl = `${data?.url ?? prUrl}/checks`;

  return (
    <div className="w-[340px] py-1 text-xs">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="font-semibold text-[var(--theme-text-primary)]">CI checks</span>
        {detail?.loading && <Spinner size={10} />}
        <button
          type="button"
          role="menuitem"
          onClick={() => onOpenUrl(checksUrl)}
          className="ml-auto rounded px-1.5 py-0.5 text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]"
        >
          ↗ Checks
        </button>
      </div>
      {countsLine && <div className="px-3 pb-1.5 text-[11px] text-[var(--theme-text-muted)]">{countsLine}</div>}

      <div className="border-t border-[var(--theme-border)] py-1">
        {data ? (
          <CheckRows checks={data.checks} totalChecks={data.totalChecks} checksUrl={checksUrl} onOpenUrl={onOpenUrl} />
        ) : detail?.error ? (
          <div className="flex items-center gap-2 px-3 py-1.5 text-[var(--theme-text-secondary)]">
            <span className={tintText('red')}>Couldn't load checks</span>
            <span title={detail.error} className="truncate text-[var(--theme-text-muted)]">— {detail.error}</span>
            <button type="button" onClick={onRetry} className="ml-auto shrink-0 underline hover:text-[var(--theme-text-primary)]">
              Retry
            </button>
          </div>
        ) : (
          <div data-testid="pr-ci-skeleton" className="space-y-1.5 px-3 py-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-[var(--theme-bg-overlay)]" />
            ))}
          </div>
        )}
      </div>

      {data && data.allowedMergeMethods.length > 0 && (
        <MergeSection
          methods={data.allowedMergeMethods}
          availability={mergeBlockReason(data)}
          onMerge={onMerge}
        />
      )}
    </div>
  );
}

function CheckRows({ checks, totalChecks, checksUrl, onOpenUrl }: {
  checks: PrCheck[];
  totalChecks: number;
  checksUrl: string;
  onOpenUrl: (url: string) => void;
}) {
  if (totalChecks === 0) {
    return <div className="px-3 py-1.5 text-[var(--theme-text-muted)]">No checks reported on the latest commit.</div>;
  }
  const shown = checks.slice(0, MAX_CHECK_ROWS);
  const more = totalChecks - shown.length;
  return (
    <>
      {shown.map((check, i) => {
        const url = check.detailsUrl;
        return (
          <button
            key={`${check.name}-${i}`}
            type="button"
            role="menuitem"
            disabled={!url}
            onClick={() => url && onOpenUrl(url)}
            className="flex w-full items-center gap-2 px-3 py-1 text-left enabled:hover:bg-[var(--theme-bg-overlay)] disabled:cursor-default"
          >
            <span className={cn('w-3 shrink-0 text-center', tintClasses(BUCKET_HUE[check.bucket]).solidText)}>
              {BUCKET_GLYPH[check.bucket]}
            </span>
            <span title={check.name} className="min-w-0 flex-1 truncate text-[var(--theme-text-primary)]">{check.name}</span>
            <span className="shrink-0 text-[11px] text-[var(--theme-text-muted)]">{formatCheckDuration(check)}</span>
            <span className={cn('w-3 shrink-0 text-[var(--theme-text-muted)]', !url && 'invisible')}>↗</span>
          </button>
        );
      })}
      {more > 0 && (
        <button
          type="button"
          role="menuitem"
          onClick={() => onOpenUrl(checksUrl)}
          className="flex w-full items-center gap-2 px-3 py-1 text-left text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]"
        >
          <span className="w-3 shrink-0 text-center">…</span>
          <span className="flex-1">+{more} more on GitHub</span>
          <span className="w-3 shrink-0">↗</span>
        </button>
      )}
    </>
  );
}

function MergeSection({ methods, availability, onMerge }: {
  methods: PrMergeMethod[];
  availability: ReturnType<typeof mergeBlockReason>;
  onMerge: (method: PrMergeMethod) => void;
}) {
  return (
    <div className="border-t border-[var(--theme-border)] py-1">
      <div className="px-3 py-1 font-semibold text-[var(--theme-text-primary)]">Merge</div>
      {methods.map((method, i) => (
        <button
          key={method}
          type="button"
          role="menuitem"
          disabled={availability.blocked}
          onClick={() => onMerge(method)}
          className="flex w-full items-center gap-2 px-3 py-1 pl-5 text-left text-[var(--theme-text-primary)] enabled:hover:bg-[var(--theme-bg-overlay)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex-1">{mergeMethodLabel(method)}</span>
          {i === 0 && <span className="text-[11px] text-[var(--theme-text-muted)]">(default)</span>}
        </button>
      ))}
      {availability.message && (
        <div className={cn('flex items-center gap-1.5 px-5 py-1 text-[11px]', availability.blocked ? tintText('yellow') : 'text-[var(--theme-text-muted)]')}>
          <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', tintSolid(availability.blocked ? 'yellow' : 'gray'))} />
          {availability.message}
        </div>
      )}
    </div>
  );
}
