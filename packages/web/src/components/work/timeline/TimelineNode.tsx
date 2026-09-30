/**
 * The focusable pictos of the Timeline, absolutely positioned on the content
 * band: spine nodes (creation, runs, steps — round, with label / sub-label /
 * note / replay badge), and the smaller lane pictos (top: CLI sessions,
 * workflow starts, priority; bottom: deliverables, comments, PR chips).
 * Every one is a <button> with an aria-label and the shared Tooltip.
 */
import { memo } from 'react';
import { cn } from '../../../lib/cn';
import { tint, tintText } from '../../../lib/tints';
import { getPrBadgeClasses } from '../../../lib/prBadgeStyle';
import { Tooltip } from '../../ui/Tooltip';
import { PrIcon } from '../queue/QueuePrGlyph';
import type { TimelineAction, TimelineEvent } from './buildTimeline';
import { GEOMETRY, noteOffset, type PlacedEvent } from './layoutTimeline';
import { GlyphIcon, glyphHue, useDeliverableColor } from './TimelineGlyph';
import { TimelineTooltip } from './TimelineTooltip';

interface NodeProps {
  item: PlacedEvent;
  onAction: (action: TimelineAction, event: TimelineEvent) => void;
}

function clickHandler(e: TimelineEvent, onAction: NodeProps['onAction']) {
  return e.action ? () => onAction(e.action!, e) : undefined;
}

/** A round spine node + its label, sub-label, note and replay badge. */
export const SpineNode = memo(function SpineNode({ item, onAction }: NodeProps) {
  const e = item.event;
  const hue = glyphHue(e.glyph);
  const size = e.gate ? 36 : 32;
  const labelWidth = item.width - 12;
  const sub = e.sub ? `${e.sub} · ${e.clock}` : e.clock;

  return (
    <>
      {/* Note (decision / outcome) — right after the node, above the spine. */}
      {e.note && (item.textWidth != null || e.note.tone === 'ko') && (
        <div
          className="pointer-events-none absolute truncate text-[11px] italic leading-[14px] text-[var(--theme-text-muted)]"
          style={{ left: item.x + noteOffset(e), top: GEOMETRY.noteY, maxWidth: item.textWidth ?? 14 }}
        >
          {e.note.tone === 'ko' && <span className={cn('mr-1 not-italic', tintText('red'))}>✕</span>}
          {item.textWidth != null && (
            <span className={e.note.tone === 'ko' ? tintText('red') : undefined}>{e.note.text}</span>
          )}
        </div>
      )}

      <Tooltip label={<TimelineTooltip event={e} />} placement="top" interactive>
        <button
          type="button"
          data-timeline-node={e.id}
          aria-label={e.ariaLabel}
          onClick={clickHandler(e, onAction)}
          className={cn(
            'absolute flex items-center justify-center rounded-full border-2 bg-[var(--theme-bg-surface)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
            tintText(hue),
            e.state === 'cancelled' && 'opacity-45',
            !e.action && 'cursor-default',
          )}
          style={{
            left: item.x - size / 2,
            top: GEOMETRY.spineY - size / 2,
            width: size,
            height: size,
            borderColor: `var(--tint-${hue}-solid)`,
            // Gate: double ring (the second ring is the outline of the halo).
            boxShadow: e.gate ? `0 0 0 3px var(--theme-bg-surface), 0 0 0 5px var(--tint-${hue}-border)` : undefined,
          }}
        >
          {(e.state === 'running' || e.state === 'pending') && (
            <span
              aria-hidden
              className={cn(
                'absolute -inset-1 rounded-full opacity-50 motion-reduce:animate-none',
                e.state === 'running' ? 'animate-ping' : 'animate-pulse',
              )}
              style={{ backgroundColor: `var(--tint-${hue}-bg)`, boxShadow: `0 0 0 2px var(--tint-${hue}-border)` }}
            />
          )}
          <span className="relative flex items-center justify-center">
            <GlyphIcon glyph={e.glyph} size={16} />
          </span>
          {e.attempt > 1 && (
            <span className="absolute -right-4 -top-3 rounded-full bg-[var(--theme-text-primary)] px-1.5 text-[10px] font-semibold leading-[16px] text-[var(--theme-bg-base)]">
              {e.attempt}e
            </span>
          )}
        </button>
      </Tooltip>

      <div
        className="pointer-events-none absolute text-center leading-tight"
        style={{ left: item.x - labelWidth / 2, top: GEOMETRY.labelY, width: labelWidth }}
      >
        <div className={cn('truncate text-[12px] font-semibold', e.gate ? tintText('yellow') : 'text-[var(--theme-text-primary)]')}>
          {e.label}
        </div>
        <div className="truncate text-[11px] text-[var(--theme-text-muted)]">{sub}</div>
      </div>
    </>
  );
});

/** A top / bottom lane picto (28px top, 26px bottom), or a PR chip. */
export const LanePicto = memo(function LanePicto({ item, onAction }: NodeProps) {
  const e = item.event;
  const g = e.glyph;
  const top = e.lane === 'top';
  const size = top ? 28 : 26;
  const y = top ? GEOMETRY.topY : GEOMETRY.bottomY;
  const delivColor = useDeliverableColor(g.type === 'deliverable' ? g.deliverableType : null);

  if (g.type === 'pr') {
    return (
      <Tooltip label={<TimelineTooltip event={e} />} placement="top" interactive>
        <button
          type="button"
          data-timeline-node={e.id}
          aria-label={e.ariaLabel}
          onClick={clickHandler(e, onAction)}
          className={cn(
            'absolute flex items-center justify-center gap-1 rounded-full px-1.5 font-mono text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
            getPrBadgeClasses({ state: g.state === 'draft' || !g.state ? 'open' : g.state, isDraft: g.state === 'draft' }),
          )}
          style={{ left: item.x - (item.width - 4) / 2, top: y + 2, width: item.width - 4, height: 22 }}
        >
          <PrIcon state={g.state} />
          {g.label}
        </button>
      </Tooltip>
    );
  }

  const hue = glyphHue(g);
  const round = g.type === 'comment';
  const style: React.CSSProperties = {
    left: item.x - size / 2,
    top: y,
    width: size,
    height: size,
  };
  let colorClass = tint(hue);
  if (g.type === 'deliverable') {
    colorClass = delivColor ? '' : tint('gray');
    if (delivColor) Object.assign(style, { color: delivColor.text, backgroundColor: delivColor.bg, borderColor: delivColor.text, borderWidth: 1.5 });
  }

  return (
    <>
      <Tooltip label={<TimelineTooltip event={e} />} placement="top" interactive>
        <button
          type="button"
          data-timeline-node={e.id}
          aria-label={e.ariaLabel}
          onClick={clickHandler(e, onAction)}
          className={cn(
            'absolute flex items-center justify-center border outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
            round ? 'rounded-full' : 'rounded-md',
            colorClass,
            !e.action && 'cursor-default',
          )}
          style={style}
        >
          <GlyphIcon glyph={g} size={16} />
          {g.type === 'deliverable' && g.unread && (
            <span aria-label="non lu" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--tint-pink-solid)] ring-2 ring-[var(--theme-bg-surface)]" />
          )}
        </button>
      </Tooltip>
      {e.kind === 'priority' && item.textWidth != null && (
        <div
          className={cn('pointer-events-none absolute truncate text-[11px] italic', tintText('orange'))}
          style={{ left: item.x + size / 2 + 4, top: y + 6, maxWidth: item.textWidth }}
        >
          {e.label}
        </div>
      )}
    </>
  );
});
