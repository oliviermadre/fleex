/**
 * The « Temps » block of the Timeline's fixed column (spec v3). Zone A — always
 * visible, even at the drawer's minimum height: time before the 1st Doing, the
 * ticket's life (customer lead time when closed, age when open), then how long
 * it has been in its status, and a bar splitting the life between statuses.
 * Zone B: the per-status detail, scrolled with the column when the drawer is low.
 * Unaffected by the frieze filters.
 */
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { STATUS_COLORS, STATUS_HUES } from '../../../lib/statusColors';
import type { TimelineSummary, TimelineTimeMetric } from './buildTimeline';
import { GlyphIcon } from './TimelineGlyph';

const statusLabel = (s: string) => TICKET_STATUS_LABELS[s] ?? s;
const pct = (share: number) => `${Math.round(share * 100)} %`;

function Row({
  label,
  metric,
  separated = false,
  testId,
}: {
  label: React.ReactNode;
  metric: TimelineTimeMetric | null;
  separated?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      title={metric?.hint ?? undefined}
      className={cn(
        'grid grid-cols-[1fr_auto] gap-2',
        separated && 'mt-0.5 border-t border-dashed border-[var(--theme-border-input)] pt-px',
      )}
    >
      <dt className="truncate text-[var(--theme-text-secondary)]">{label}</dt>
      <dd
        className={cn(
          'm-0 whitespace-nowrap text-right tabular-nums',
          !metric || metric.ms === null
            ? 'text-[var(--theme-text-faint)]'
            : separated ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-primary)]',
        )}
      >
        {metric?.label ?? '—'}
      </dd>
    </div>
  );
}

export function TimelineTimeSummary({ summary }: { summary: TimelineSummary | null }) {
  if (!summary) {
    // Skeleton: the column does not jump when the model arrives.
    return (
      <section aria-label="Temps du ticket" className="text-[11px] leading-[15px]">
        <dl className="m-0">
          <Row label="Avant 1er Doing" metric={null} />
          <Row label="Âge" metric={null} />
          <Row label="Depuis" metric={null} />
        </dl>
      </section>
    );
  }

  const { since, lifetime, byStatus } = summary;
  const showSplit = summary.lifeMs > 0 && byStatus.length > 0;

  return (
    <section aria-label="Temps du ticket" className="text-[11px] leading-[15px]">
      <dl className="m-0">
        <Row label="Avant 1er Doing" metric={summary.timeToFirstDoing} />
        <Row label={lifetime.kind === 'leadTime' ? 'Lead time client' : 'Âge'} metric={lifetime} />
        <Row
          testId="timeline-time-since"
          separated={since.closed}
          metric={since}
          label={
            <>
              <span className="font-medium" style={{ color: `var(--tint-${STATUS_HUES[since.status] ?? 'gray'}-solid)` }}>
                {statusLabel(since.status)}
              </span>{' '}
              depuis
            </>
          }
        />
      </dl>

      {showSplit && (
        <>
          <div
            role="img"
            aria-label={`Répartition sur la durée de vie : ${byStatus.map((b) => `${statusLabel(b.status)} ${pct(b.share)}`).join(', ')}`}
            className="my-1 flex h-1.5 gap-px overflow-hidden rounded-full bg-[var(--theme-bg-hover)]"
          >
            {byStatus.map((b) => (
              <span
                key={b.status}
                title={`${statusLabel(b.status)} · ${b.durationLabel} (${pct(b.share)})`}
                className="h-full min-w-[2px]"
                style={{ flex: `${b.share} 0 0`, background: `var(--tint-${STATUS_HUES[b.status] ?? 'gray'}-solid)` }}
              />
            ))}
          </div>

          <ul className="m-0 flex list-none flex-col p-0" aria-label="Temps par statut">
            {byStatus.map((b) => (
              <li
                key={b.status}
                data-testid="timeline-status-total"
                className="grid grid-cols-[10px_64px_1fr] items-center gap-x-1"
              >
                <span className={cn('h-[7px] w-[7px] rounded-full', STATUS_COLORS[b.status]?.bar)} aria-hidden />
                <span
                  className={b.current ? 'font-medium text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]'}
                  title={b.current ? 'Statut en cours, la durée augmente' : undefined}
                >
                  {statusLabel(b.status)}
                </span>
                <span className="flex justify-end gap-1 whitespace-nowrap tabular-nums text-[var(--theme-text-primary)]">
                  <span>{b.durationLabel}</span>
                  {b.passages > 1 && <span className="text-[var(--theme-text-muted)]">×{b.passages}</span>}
                  {b.interventions > 0 && (
                    <span
                      className="flex items-center gap-0.5 text-[var(--theme-text-secondary)] [&_svg]:h-3 [&_svg]:w-3"
                      title={`${b.interventions} intervention${b.interventions > 1 ? 's' : ''} humaine${b.interventions > 1 ? 's' : ''}`}
                    >
                      <GlyphIcon glyph={{ type: 'human' }} size={12} />
                      {b.interventions}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
