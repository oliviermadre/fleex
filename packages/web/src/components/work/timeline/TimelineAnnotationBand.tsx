/**
 * The annotation band above the frieze (SPEC annotations §5.1): always-visible
 * cards (title, time, author, thumbnail) — nothing to hover — each hung from a
 * dotted line in its tone that stops on the lifeline at its exact instant; plus
 * the ghost "+" that follows the cursor. Only that "+" bubble is clickable
 * (it lights up on hover): a click elsewhere in the band never creates.
 * Pure rendering: placement comes from layoutAnnotations, clicks go up.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import type { UiAnnotation } from '../../../stores/annotationStore';
import { GEOMETRY } from './layoutTimeline';
import {
  CARD_H,
  CARD_W,
  PILL,
  PILL_STACK_W,
  PILL_TOP,
  TONE_HUE,
  cardTop,
  firstImage,
  hasMoreThanTitle,
  type AnnotationBand,
  type CursorInstant,
  type PlacedCard,
} from './layoutAnnotations';
import { AgentTag, longWhen } from './AnnotationPopovers';
import { AnnotationToneIcon } from './AnnotationToneIcon';
import { AlertIcon, CommentLineIcon, MagnetIcon, PlusIcon, TextLinesIcon } from '../../ui/icons/AnnotationIcons';

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:32" today, "14 oct. 14:32" otherwise. */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${hm}`;
}

const solid = (a: UiAnnotation) => (a.uiState === 'error' ? 'var(--tint-red-solid)' : `var(--tint-${TONE_HUE[a.tone]}-solid)`);

export function cardNodeId(card: PlacedCard<UiAnnotation>): string {
  return card.kind === 'card' ? `annotation:${card.item.annotation.id}` : `annotation-stack:${card.items[0]!.annotation.id}`;
}

interface Props {
  band: AnnotationBand<UiAnnotation>;
  width: number;
  ghost: CursorInstant | null;
  highlight: { id: string; nonce: number } | null;
  onOpenCard: (card: PlacedCard<UiAnnotation>, el: HTMLElement) => void;
  /** The ghost "+" bubble was clicked: annotate this instant. */
  onCreate: (at: number, el: HTMLElement) => void;
}

/** The dotted anchors (an SVG over the whole content) — drawn under the cards and pictos. */
export function AnnotationAnchors({ band, width }: { band: AnnotationBand<UiAnnotation>; width: number }) {
  const h = band.height;
  // The anchor lands ON the lifeline (its dot), never past it.
  const spine = h + GEOMETRY.spineY;
  return (
    <svg className="pointer-events-none absolute left-0 top-0" width={width} height={h + GEOMETRY.height} aria-hidden>
      {band.cards.flatMap((card) => {
        const mini = band.mode === 'mini';
        const y0 = mini ? PILL_TOP + PILL : cardTop(card.row, h) + CARD_H;
        const cardW = mini ? (card.kind === 'card' ? PILL : PILL_STACK_W) : CARD_W;
        const items = card.kind === 'card' ? [card.item] : card.items;
        const lines = items.map(({ annotation: a, x }) => {
          // A card pushed sideways keeps its anchor on the exact instant: short elbow.
          const cx = Math.min(Math.max(x, card.left + Math.min(10, cardW / 2)), card.left + cardW - Math.min(10, cardW / 2));
          return (
            <g key={`anchor-${a.id}`} data-testid="annotation-anchor">
              <path
                d={`M${cx} ${y0} L${cx} ${y0 + 3} L${x} ${y0 + 7} L${x} ${spine}`}
                fill="none"
                stroke={solid(a)}
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.8}
              />
              <circle cx={x} cy={spine} r={3} fill={solid(a)} />
            </g>
          );
        });
        return lines;
      })}
    </svg>
  );
}

export function TimelineAnnotationBand({ band, width, ghost, highlight, onOpenCard, onCreate }: Props) {
  const h = band.height;
  const [pulsing, setPulsing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Pulse (and reveal) a card on request — e.g. from the comment's "Épinglé" badge.
  useEffect(() => {
    if (!highlight) return;
    const card = band.cards.find((c) => (c.kind === 'card' ? [c.item] : c.items).some((i) => i.annotation.id === highlight.id));
    if (!card) return;
    const id = cardNodeId(card);
    setPulsing(id);
    root.current?.querySelector<HTMLElement>(`[data-timeline-node="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setPulsing(null), 1200);
    return () => clearTimeout(t);
    // Only a new highlight request triggers it, not every re-layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.nonce]);

  if (h === 0) return null;

  return (
    <div ref={root} className="contents">
      {h > 0 && <div className="pointer-events-none absolute left-0 border-t border-dashed border-[var(--theme-border)]" style={{ top: h, width }} />}
      {band.cards.length === 0 && (
        <div className="pointer-events-none absolute left-2 top-0 whitespace-nowrap text-[10px] leading-[14px] text-[var(--theme-text-faint)]">
          + survoler ici pour annoter
        </div>
      )}

      {band.cards.map((card) => {
        const id = cardNodeId(card);
        const top = cardTop(card.row, h);
        const pulse = pulsing === id;
        if (band.mode === 'mini') return <AnnotationPill key={id} id={id} card={card} pulse={pulse} onOpen={onOpenCard} />;
        if (card.kind === 'stack') {
          const first = card.items[0]!.annotation;
          const last = card.items[card.items.length - 1]!.annotation;
          return (
            <button
              key={id}
              type="button"
              data-timeline-node={id}
              aria-label={`${card.items.length} annotations`}
              onClick={(e) => onOpenCard(card, e.currentTarget)}
              className={cn(
                'absolute z-[4] flex flex-col justify-between overflow-hidden rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] px-2.5 py-1.5 text-left',
                'shadow-[3px_-3px_0_-1px_var(--theme-bg-overlay),3px_-3px_0_0_var(--theme-border-input),6px_-6px_0_-1px_var(--theme-bg-overlay),6px_-6px_0_0_var(--theme-border-input)]',
                pulse && 'ring-2 ring-[var(--theme-accent)]',
              )}
              style={{ left: card.left, top, width: CARD_W, height: CARD_H }}
            >
              <span className="text-[12.5px] font-semibold text-[var(--theme-text-primary)]">{card.items.length} annotations</span>
              <span className="flex items-center gap-0.5 truncate font-mono text-[10px] text-[var(--theme-text-muted)]">
                {card.items.map(({ annotation: a }) => (
                  <AnnotationToneIcon key={a.id} tone={a.tone} size={11} hue={a.uiState === 'error' ? 'red' : undefined} />
                ))}
                <span className="ml-1 truncate">{shortWhen(first.at)} → {shortWhen(last.at)}</span>
              </span>
            </button>
          );
        }
        const a = card.item.annotation;
        const img = firstImage(a.body);
        const hue = a.uiState === 'error' ? 'red' : TONE_HUE[a.tone];
        return (
          <button
            key={id}
            type="button"
            data-timeline-node={id}
            data-testid="annotation-card"
            aria-label={`Annotation : ${a.title}, ${longWhen(a.at)}`}
            onClick={(e) => onOpenCard(card, e.currentTarget)}
            className={cn(
              'absolute z-[4] flex gap-2 overflow-hidden rounded-md border py-1.5 pl-3 pr-2 text-left transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-lg',
              a.uiState === 'saving' && 'opacity-60',
              pulse && 'ring-2 ring-[var(--theme-accent)]',
            )}
            style={{
              left: card.left,
              top,
              width: CARD_W,
              height: CARD_H,
              background: `var(--tint-${hue}-bg)`,
              borderColor: `var(--tint-${hue}-border)`,
              boxShadow: `inset 3px 0 0 var(--tint-${hue}-solid)`,
            }}
          >
            {img && <img src={img} alt="" className="h-10 w-10 shrink-0 rounded border border-[var(--theme-border)] object-cover" />}
            <span className="flex min-w-0 flex-col justify-between">
              <span className="flex items-start gap-1.5">
                <AnnotationToneIcon tone={a.tone} size={13} hue={hue} className="mt-px" />
                <span className="line-clamp-2 text-[12px] font-semibold leading-[15px] text-[var(--theme-text-primary)]">{a.title}</span>
              </span>
              <span className={cn('flex items-center gap-1 truncate font-mono text-[10px]', a.uiState === 'error' ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-muted)]')}>
                {a.uiState === 'error' ? (
                  <>
                    <AlertIcon size={11} className="shrink-0" />
                    échec — cliquer pour réessayer
                  </>
                ) : (
                  <>
                    {shortWhen(a.at)} ·{a.authorType === 'agent' && <AgentTag />}
                    <span className="truncate">{a.authorName}</span>
                    {hasMoreThanTitle(a.body) && <TextLinesIcon size={11} className="shrink-0" />}
                    {a.sourceCommentId && <CommentLineIcon size={11} className="shrink-0" />}
                    {a.uiState === 'saving' && ' · enregistrement…'}
                  </>
                )}
              </span>
            </span>
          </button>
        );
      })}

      {ghost && (
        <div className="pointer-events-none absolute top-0 z-[6]" style={{ left: ghost.x }} data-testid="annotation-ghost">
          <div
            className={cn('absolute left-0 w-0 border-l', ghost.snappedTo ? 'border-solid border-[var(--theme-accent)]' : 'border-dashed border-[var(--theme-text-secondary)]')}
            style={{ top: Math.max(0, h - 30) + 22, height: h + GEOMETRY.spineY - Math.max(0, h - 30) - 22 }}
          />
          <button
            type="button"
            data-testid="annotation-ghost-add"
            aria-label={`Annoter ici, ${longWhen(ghost.at)}`}
            onClick={(e) => {
              e.stopPropagation();
              onCreate(ghost.at, e.currentTarget);
            }}
            className={cn(
              'pointer-events-auto absolute -left-[11px] flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full border bg-[var(--theme-bg-surface)] transition-[background-color,border-color,color,box-shadow]',
              'hover:border-solid hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent)] hover:text-[var(--theme-accent-fg)] hover:shadow-[0_0_0_4px_var(--theme-accent-muted)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
              ghost.snappedTo ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]' : 'border-dashed border-[var(--theme-text-secondary)] text-[var(--theme-text-primary)]',
            )}
            style={{ top: Math.max(0, h - 30) }}
          >
            <PlusIcon size={12} />
          </button>
          <div
            className={cn(
              'absolute left-[14px] flex items-center gap-1 whitespace-nowrap rounded border bg-[var(--theme-bg-base)] px-1.5 font-mono text-[10.5px]',
              ghost.snappedTo ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]' : 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)]',
            )}
            style={{ top: Math.max(0, h - 30) + 3 }}
          >
            {ghost.snappedTo ? <MagnetIcon size={11} className="shrink-0" /> : '≈ '}
            {longWhen(ghost.at)}
            {ghost.snappedTo && ` · ${ghost.snappedTo.label}`}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mini band (drawer too short for cards): one pill per annotation — its tone
 * icon in its tone colour — or a counted pill when several would touch. Same
 * click targets as the cards: a pill opens the reader, a counted pill the list.
 */
function AnnotationPill({
  id,
  card,
  pulse,
  onOpen,
}: {
  id: string;
  card: PlacedCard<UiAnnotation>;
  pulse: boolean;
  onOpen: (card: PlacedCard<UiAnnotation>, el: HTMLElement) => void;
}) {
  const ring = pulse && 'ring-2 ring-[var(--theme-accent)]';
  if (card.kind === 'stack') {
    return (
      <button
        type="button"
        data-timeline-node={id}
        data-testid="annotation-pill"
        aria-label={`${card.items.length} annotations`}
        title={`${card.items.length} annotations`}
        onClick={(e) => onOpen(card, e.currentTarget)}
        className={cn(
          'absolute z-[4] flex items-center justify-center rounded-full border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] font-mono text-[10px] font-semibold text-[var(--theme-text-primary)] transition-transform hover:scale-110',
          ring,
        )}
        style={{ left: card.left, top: PILL_TOP, width: PILL_STACK_W, height: PILL }}
      >
        {card.items.length}
      </button>
    );
  }
  const a = card.item.annotation;
  const hue = a.uiState === 'error' ? 'red' : TONE_HUE[a.tone];
  return (
    <button
      type="button"
      data-timeline-node={id}
      data-testid="annotation-pill"
      aria-label={`Annotation : ${a.title}, ${longWhen(a.at)}`}
      title={a.title}
      onClick={(e) => onOpen(card, e.currentTarget)}
      className={cn('absolute z-[4] flex items-center justify-center rounded-full border transition-transform hover:scale-110', a.uiState === 'saving' && 'opacity-60', ring)}
      style={{
        left: card.left,
        top: PILL_TOP,
        width: PILL,
        height: PILL,
        background: `var(--tint-${hue}-bg)`,
        borderColor: `var(--tint-${hue}-border)`,
      }}
    >
      <AnnotationToneIcon tone={a.tone} size={11} hue={hue} />
    </button>
  );
}
