/**
 * Status zones in the background of the frieze: one band per status, a 2px bar
 * on top and a vertical gradient of the status tint (STATUS_HUES), a dotted
 * boundary where the status changes, and the status pill heading each zone.
 * The pill of the left-most visible zone sticks to the viewport's left edge.
 */
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { STATUS_COLORS, STATUS_HUES, getStatusBadgeClass } from '../../../lib/statusColors';
import { Tooltip } from '../../ui/Tooltip';
import type { TimelineEvent } from './buildTimeline';
import { GEOMETRY, type PlacedZone } from './layoutTimeline';
import { TimelineTooltip } from './TimelineTooltip';
import { GlyphIcon } from './TimelineGlyph';

/** Below this width a zone only shows the status dot. */
const PILL_MIN = 64;
/**
 * Max width of a pill (the actor name truncates past it). Real cap, not just an
 * estimate: the metrics badge is placed against it, so both must agree.
 */
const PILL_EST = 150;
/** Rough width of one 11px character (no DOM measuring: the layout stays pure and testable). */
const CHAR_W = 6.5;
const METRICS_GAP = 8;

/**
 * Sticky x of a zone's pill: follows the viewport's left edge while the zone is
 * on screen, without running past the zone's end (`pillWidth`: the pill's width,
 * wider than PILL_EST when the metrics are folded into it).
 */
function pillLeft(z: PlacedZone, scrollLeft: number, pillWidth = Math.min(PILL_EST, z.x1 - z.x0)): number {
  const width = z.x1 - z.x0;
  if (width < PILL_MIN) return z.x0 + 4;
  return Math.max(z.x0 + 6, Math.min(scrollLeft + 6, z.x1 - pillWidth - 6));
}

function pillTextWidth(z: PlacedZone): number {
  const label = TICKET_STATUS_LABELS[z.status] ?? z.status;
  const text = label.length + (z.actorName ? 5 + z.actorName.length : 0) + (z.approximate ? 2 : 0);
  return 30 + text * CHAR_W;
}

/** Width of a pill without metrics: capped at PILL_EST, like the rendered pill. */
function estimatePillWidth(z: PlacedZone): number {
  return Math.min(PILL_EST, z.x1 - z.x0 - 12, pillTextWidth(z));
}

/** Width of a pill with the metrics folded in: only capped by the zone. */
function estimateFusedPillWidth(z: PlacedZone): number {
  return Math.min(z.x1 - z.x0 - 12, pillTextWidth(z) + estimateMetricsWidth(z));
}

function estimateMetricsWidth(z: PlacedZone): number {
  const count = z.humanActions.total;
  return 16 + z.durationLabel.length * CHAR_W + (count > 0 ? 30 + String(count).length * CHAR_W : 0);
}

export type ZoneMetricsPlacement =
  | { mode: 'badge'; left: number }
  | { mode: 'pill' }
  | { mode: 'none' };

/**
 * Where a zone's "duration · 👤 n" goes: a badge centred on the VISIBLE part of
 * the zone (the last zone stops at the now line); pushed right of the pill when
 * they would overlap; folded into the pill when there is no room for both; only
 * in the tooltip on a narrow zone. `viewportWidth` 0 = not measured yet: the
 * whole zone counts as visible.
 */
export function placeZoneMetrics(
  z: PlacedZone,
  { scrollLeft, viewportWidth, nowX, last }: { scrollLeft: number; viewportWidth: number; nowX: number; last: boolean },
): ZoneMetricsPlacement {
  if (z.x1 - z.x0 < PILL_MIN) return { mode: 'none' };
  const end = last ? Math.min(z.x1, nowX) : z.x1;
  const v0 = Math.max(z.x0, scrollLeft);
  const v1 = viewportWidth > 0 ? Math.min(end, scrollLeft + viewportWidth) : end;
  const w = estimateMetricsWidth(z);
  let left = (v0 + v1) / 2 - w / 2;
  const pillRight = pillLeft(z, scrollLeft) + estimatePillWidth(z);
  if (left < pillRight + METRICS_GAP) left = pillRight + METRICS_GAP;
  if (left + w > end - 6) return { mode: 'pill' };
  return { mode: 'badge', left };
}

function MetricsContent({ z }: { z: PlacedZone }) {
  const count = z.humanActions.total;
  return (
    <>
      <span>{z.durationLabel}</span>
      {count > 0 && (
        <>
          <span className="opacity-60">·</span>
          <span className="flex items-center gap-0.5 [&_svg]:h-3 [&_svg]:w-3">
            <GlyphIcon glyph={{ type: 'human' }} size={12} />
            {count}
          </span>
        </>
      )}
    </>
  );
}

/** The "5 h 20 · 👤 3" badge of each wide-enough zone (decorative: the pill carries the a11y). */
export function TimelineZoneMetrics({
  zones,
  scrollLeft,
  viewportWidth,
  nowX,
}: {
  zones: PlacedZone[];
  scrollLeft: number;
  viewportWidth: number;
  nowX: number;
}) {
  return (
    <>
      {zones.map((z, i) => {
        const p = placeZoneMetrics(z, { scrollLeft, viewportWidth, nowX, last: i === zones.length - 1 });
        if (p.mode !== 'badge') return null;
        const hue = STATUS_HUES[z.status] ?? 'gray';
        return (
          <div
            key={z.eventId}
            aria-hidden
            data-testid="timeline-zone-metrics"
            className="pointer-events-none absolute flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium tabular-nums"
            style={{
              left: p.left,
              top: GEOMETRY.statusY,
              color: `var(--tint-${hue}-solid)`,
              background: `var(--tint-${hue}-bg)`,
            }}
          >
            <MetricsContent z={z} />
          </div>
        );
      })}
    </>
  );
}

/**
 * `fadeFrom`: x (the now line) past which the last zone — the current status —
 * fades out to the frieze's right edge instead of stopping flat.
 */
export function TimelineZoneBands({ zones, fadeFrom }: { zones: PlacedZone[]; fadeFrom: number }) {
  return (
    <>
      {zones.map((z, i) => {
        const hue = STATUS_HUES[z.status] ?? 'gray';
        const last = i === zones.length - 1;
        const solidUntil = Math.max(0, fadeFrom - z.x0);
        const mask = last && solidUntil < z.x1 - z.x0
          ? `linear-gradient(to right, black ${solidUntil}px, transparent 100%)`
          : undefined;
        return (
          <div
            key={z.eventId}
            aria-hidden
            className="pointer-events-none absolute top-0"
            style={{
              left: z.x0,
              width: Math.max(0, z.x1 - z.x0),
              height: GEOMETRY.height,
              background: `linear-gradient(to bottom, var(--tint-${hue}-bg) 0%, transparent 85%)`,
              opacity: 0.9,
              borderTop: `${GEOMETRY.zoneBar}px solid var(--tint-${hue}-solid)`,
              borderLeft: i > 0 ? `1px dashed var(--tint-${hue}-solid)` : undefined,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
    </>
  );
}

/**
 * Hatches the final Done/Cancelled run of a closed ticket: time out of the
 * ticket's life, not counted in the « Temps » block (the frieze itself is not
 * bounded). Starts below the status pills; an accent line marks the end of life.
 */
export function TimelineOutOfLifeBand({ zones, closedAt }: { zones: PlacedZone[]; closedAt: number | null }) {
  if (closedAt == null) return null;
  const first = zones.find((z) => z.from === closedAt && (z.status === 'done' || z.status === 'cancelled'));
  if (!first) return null;
  const x1 = zones[zones.length - 1]!.x1;
  const top = GEOMETRY.statusY + 22;
  return (
    <div
      aria-hidden
      data-testid="timeline-out-of-life"
      title="Hors durée de vie : non compté dans le temps du ticket"
      className="pointer-events-none absolute"
      style={{
        left: first.x0,
        width: Math.max(0, x1 - first.x0),
        top,
        height: GEOMETRY.height - top,
        borderLeft: '2px solid var(--theme-accent)',
        background: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--theme-text-muted) 14%, transparent) 0 6px, transparent 6px 12px)',
      }}
    />
  );
}

export function TimelineZonePills({
  zones,
  events,
  scrollLeft,
  viewportWidth,
  nowX,
}: {
  zones: PlacedZone[];
  events: Map<string, TimelineEvent>;
  scrollLeft: number;
  viewportWidth: number;
  nowX: number;
}) {
  return (
    <>
      {zones.map((z, i) => {
        const width = z.x1 - z.x0;
        const narrow = width < PILL_MIN;
        const inPill = placeZoneMetrics(z, { scrollLeft, viewportWidth, nowX, last: i === zones.length - 1 }).mode === 'pill';
        const left = pillLeft(z, scrollLeft, inPill ? estimateFusedPillWidth(z) : undefined);
        const event = events.get(z.eventId);
        const label = TICKET_STATUS_LABELS[z.status] ?? z.status;
        const pill = (
          <button
            type="button"
            data-timeline-node={z.eventId}
            aria-label={event?.ariaLabel ?? label}
            className={cn(
              'absolute flex h-5 cursor-default items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
              narrow ? 'w-5 justify-center' : 'px-2',
              getStatusBadgeClass(z.status),
            )}
            style={{ left: narrow ? z.x0 + 4 : left, top: GEOMETRY.statusY, maxWidth: Math.max(20, inPill ? width - 12 : Math.min(PILL_EST, width - 12)) }}
          >
            <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_COLORS[z.status]?.bar)} />
            {!narrow && (
              <>
                <span>{label}</span>
                {z.actorName && <span className="truncate italic text-[var(--theme-text-muted)]">par {z.actorName}</span>}
                {z.approximate && !inPill && <span className="italic text-[var(--theme-text-muted)]">≈</span>}
                {inPill && (
                  <span data-testid="timeline-zone-metrics" className="flex shrink-0 items-center gap-1 tabular-nums">
                    <span className="opacity-60">·</span>
                    <MetricsContent z={z} />
                  </span>
                )}
              </>
            )}
          </button>
        );
        return event ? (
          <Tooltip key={z.eventId} label={<TimelineTooltip event={event} />} placement="bottom" interactive>
            {pill}
          </Tooltip>
        ) : (
          <span key={z.eventId}>{pill}</span>
        );
      })}
    </>
  );
}
