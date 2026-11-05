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
import { GEOMETRY, carriesText, noteOffset, type PlacedEvent } from './layoutTimeline';
import { GlyphIcon, glyphHue, useDeliverableColor } from './TimelineGlyph';
import { TimelineTooltip } from './TimelineTooltip';

interface NodeProps {
  item: PlacedEvent;
  onAction: (action: TimelineAction, event: TimelineEvent) => void;
}

/**
 * « Compacter les échanges » is on: which segments the capsule may show (the
 * Commentaires / Livrables filters hide theirs). Null → the plain node.
 */
export interface CapsuleSegments {
  reply: boolean;
  deliverables: boolean;
}

function clickHandler(e: TimelineEvent, onAction: NodeProps['onAction']) {
  return e.action ? () => onAction(e.action!, e) : undefined;
}

/** Width of one tray segment; the tray slides under the round node by TRAY_UNDER px. */
const SEGMENT = 18;
const TRAY_UNDER = 17;

/**
 * The tray of an exchange capsule, right of its round node: the agent's reply
 * (💬, yellow « ? » while it waits for the user) and its deliverables (📄, a
 * counter from 2, the pink dot when one is unread). Each segment is its own
 * button, a sibling of the round one (no nested button).
 */
function CapsuleTray({ item, segments, onAction }: NodeProps & { segments: CapsuleSegments }) {
  const e = item.event;
  const x = e.exchange!;
  const hue = glyphHue(e.glyph);
  const last = x.deliverables[x.deliverables.length - 1] ?? null;
  const delivColor = useDeliverableColor(last?.type ?? null);
  const tooltip = <TimelineTooltip event={e} content={x.tooltip} onAction={onAction} />;
  const reply = segments.reply ? x.reply : null;
  const deliv = segments.deliverables ? last : null;
  const agent = e.label.split(' · ')[0];
  // Running with nothing out yet: « … » in the tray.
  const dots = e.state === 'running' && !reply && !deliv;
  if (!reply && !deliv && !dots) return null;

  const segmentClass =
    'relative flex shrink-0 items-center justify-center border outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]';
  return (
    <div
      data-testid="timeline-capsule-tray"
      className={cn(
        'absolute flex items-center gap-0.5 rounded-r-full border border-l-0 bg-[var(--theme-bg-surface)] pr-[3px]',
        e.state === 'cancelled' && 'opacity-45',
      )}
      style={{
        left: item.x,
        top: GEOMETRY.spineY - 12,
        height: 24,
        paddingLeft: TRAY_UNDER,
        borderColor: `var(--tint-${e.state === 'ko' ? 'red' : hue}-border)`,
      }}
    >
      {dots && (
        <span aria-label="en cours" className="flex h-[18px] items-center gap-[3px] px-1">
          {[0, 200, 400].map((d) => (
            <span
              key={d}
              className="h-1 w-1 animate-pulse rounded-full motion-reduce:animate-none"
              style={{ backgroundColor: `var(--tint-${hue}-solid)`, animationDelay: `${d}ms` }}
            />
          ))}
        </span>
      )}
      {reply && (
        <Tooltip label={tooltip} placement="top" interactive>
          <button
            type="button"
            data-testid="timeline-capsule-reply"
            aria-label={reply.waiting ? `Question de ${agent}, attend ta réponse` : `Réponse de ${agent}`}
            onClick={() => onAction({ type: 'comment', commentId: reply.commentId }, e)}
            className={cn(segmentClass, 'rounded-full', reply.waiting ? cn(tint('yellow'), 'text-[12px] font-bold') : tint('purple'))}
            style={{ width: SEGMENT, height: SEGMENT }}
          >
            {reply.waiting ? '?' : <GlyphIcon glyph={{ type: 'comment', human: false }} size={14} />}
          </button>
        </Tooltip>
      )}
      {deliv && (
        <Tooltip label={tooltip} placement="top" interactive>
          <button
            type="button"
            data-testid="timeline-capsule-deliverable"
            aria-label={`Livrable ${deliv.type} : ${deliv.title}${x.deliverables.length > 1 ? ` (${x.deliverables.length} livrables)` : ''}`}
            onClick={() => onAction({ type: 'deliverable', deliverableId: deliv.id }, e)}
            className={cn(segmentClass, 'rounded-[5px]', !delivColor && tint('gray'))}
            style={{
              width: SEGMENT,
              height: SEGMENT,
              ...(delivColor ? { color: delivColor.text, backgroundColor: delivColor.bg, borderColor: delivColor.text } : {}),
            }}
          >
            <GlyphIcon glyph={{ type: 'deliverable', deliverableType: deliv.type, unread: false }} size={14} />
            {x.deliverables.some((d) => d.unread) && (
              <span aria-label="non lu" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--tint-pink-solid)] ring-2 ring-[var(--theme-bg-surface)]" />
            )}
            {x.deliverables.length > 1 && (
              <span className="absolute -bottom-1.5 -right-1.5 rounded-full bg-[var(--theme-text-primary)] px-[3px] text-[9px] font-semibold leading-[12px] text-[var(--theme-bg-base)]">
                {x.deliverables.length}
              </span>
            )}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * A round spine node + its label, its time, note and replay badge. With
 * `segments` and an exchange, it is drawn as a capsule (round + tray).
 */
export const SpineNode = memo(function SpineNode({ item, onAction, segments = null }: NodeProps & { segments?: CapsuleSegments | null }) {
  const e = item.event;
  const hue = glyphHue(e.glyph);
  const size = e.gate ? 36 : 32;
  const labelWidth = item.width - 12;
  const capsule = segments && e.exchange ? e.exchange : null;
  const queued = !!capsule && !!e.compactOnly && e.state === 'pending';
  const halo = e.state === 'running' || e.state === 'pending' || !!capsule?.waiting;

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

      {capsule && <CapsuleTray item={item} segments={segments!} onAction={onAction} />}

      <Tooltip
        label={<TimelineTooltip event={e} content={capsule?.tooltip} onAction={capsule ? onAction : undefined} />}
        placement="top"
        interactive
      >
        <button
          type="button"
          data-timeline-node={e.id}
          aria-label={capsule ? capsule.ariaLabel : e.ariaLabel}
          onClick={clickHandler(e, onAction)}
          className={cn(
            'absolute flex items-center justify-center rounded-full border-2 bg-[var(--theme-bg-surface)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
            tintText(e.state === 'ko' && capsule ? 'red' : hue),
            e.state === 'cancelled' && 'opacity-45',
            queued && 'border-dashed opacity-60',
            !e.action && 'cursor-default',
          )}
          style={{
            left: item.x - size / 2,
            top: GEOMETRY.spineY - size / 2,
            width: size,
            height: size,
            borderColor: `var(--tint-${e.state === 'ko' && capsule ? 'red' : hue}-solid)`,
            // Gate: double ring (the second ring is the outline of the halo).
            boxShadow: e.gate ? `0 0 0 3px var(--theme-bg-surface), 0 0 0 5px var(--tint-${hue}-border)` : undefined,
          }}
        >
          {halo && (
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
        {/* Time only: who / which trigger lives in the node's tooltip. */}
        <div className="truncate text-[11px] text-[var(--theme-text-muted)]">{e.clock}</div>
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
      {carriesText(e) && item.textWidth != null && (
        <div
          className={cn('pointer-events-none absolute truncate text-[11px] italic', tintText(hue))}
          style={{ left: item.x + size / 2 + 4, top: y + 6, maxWidth: item.textWidth }}
        >
          {e.label}
        </div>
      )}
    </>
  );
});
