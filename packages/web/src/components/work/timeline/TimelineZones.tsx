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

/** Below this width a zone only shows the status dot. */
const PILL_MIN = 64;
const PILL_EST = 150;

export function TimelineZoneBands({ zones }: { zones: PlacedZone[] }) {
  return (
    <>
      {zones.map((z, i) => {
        const hue = STATUS_HUES[z.status] ?? 'gray';
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
            }}
          />
        );
      })}
    </>
  );
}

export function TimelineZonePills({
  zones,
  events,
  scrollLeft,
}: {
  zones: PlacedZone[];
  events: Map<string, TimelineEvent>;
  scrollLeft: number;
}) {
  return (
    <>
      {zones.map((z) => {
        const width = z.x1 - z.x0;
        const narrow = width < PILL_MIN;
        // Sticky: follow the viewport's left edge while the zone is on screen.
        const left = Math.max(z.x0 + 6, Math.min(scrollLeft + 6, z.x1 - Math.min(PILL_EST, width) - 6));
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
            style={{ left: narrow ? z.x0 + 4 : left, top: GEOMETRY.statusY, maxWidth: Math.max(20, width - 12) }}
          >
            <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_COLORS[z.status]?.bar)} />
            {!narrow && (
              <>
                <span>{label}</span>
                {z.actorName && <span className="truncate italic text-[var(--theme-text-muted)]">par {z.actorName}</span>}
                {z.approximate && <span className="italic text-[var(--theme-text-muted)]">≈</span>}
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
