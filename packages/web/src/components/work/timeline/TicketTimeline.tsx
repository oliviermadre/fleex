/**
 * The ticket Timeline frieze (SPEC §6): a fixed 232px column (ticket identity,
 * filter menu, « Temps » block, undatable PRs) beside a horizontally scrolling viewport.
 * The content band is 196px tall, drawn in two layers — an SVG for lines
 * (spine, connectors, now line, fork, day separators) and absolutely placed
 * HTML for everything focusable. Independent of WorkView (props only), so the
 * Kanban ticket detail can reuse it later.
 *
 * Scrolling: opens scrolled to "now"; new events keep the view pinned right
 * only if the user was already there; a vertical wheel scrolls horizontally;
 * ←/→ walk the pictos (and annotation cards) in chronological order.
 *
 * Annotations (optional `annotations` prop) live in a band ABOVE the frieze:
 * the frieze is laid out without them and simply shifted down by the band, so
 * they never widen it nor move a picto. Hovering the band (or ⌥ + hovering
 * the frieze) shows a "+" at the instant under the cursor; clicking it, or
 * pressing A on a focused picto, asks to annotate that instant.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TicketType } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { PrBadgeGroup } from '../../ui/PrBadgeGroup';
import { parseGithubPrRef } from '../../../lib/prRef';
import type { TimelineFilterKey } from '../../../stores/workStore';
import { TicketTypeIconSvg } from '../../tickets/TicketTypeIconSvg';
import { TimelineZoomControl } from './TimelineZoomControl';
import type { TimelineAction, TimelineEvent, TimelineModel } from './buildTimeline';
import { GEOMETRY, layoutTimeline, type TimelineFilters } from './layoutTimeline';
import { LanePicto, SpineNode } from './TimelineNode';
import { TimelineOutOfLifeBand, TimelineZoneBands, TimelineZoneMetrics, TimelineZonePills } from './TimelineZones';
import { TimelineFilterMenu } from './TimelineFilterMenu';
import { TimelineTimeSummary } from './TimelineTimeSummary';
import { TimelineForkCurves, TimelineForkOptions } from './TimelineFork';
import { glyphHue } from './TimelineGlyph';
import type { UiAnnotation } from '../../../stores/annotationStore';
import { ghostTop, inCreateStrip, instantAtCursor, layoutAnnotationBand, rowsForBudget, timeAnchors, type CursorInstant, type PlacedCard } from './layoutAnnotations';
import { AnnotationAnchors, TimelineAnnotationBand, cardNodeId } from './TimelineAnnotationBand';
import type { AnchorRect } from './AnnotationPopovers';

const COLUMN_W = 232;
const STICK_SLACK = 40;

export interface TicketTimelineHeader {
  number: number | null;
  title: string;
  boardName: string | null;
  status: string;
  type: string | null;
}

export interface TimelineAnnotationsProps {
  list: readonly UiAnnotation[];
  highlight: { id: string; nonce: number } | null;
  /** Annotate this instant (ms epoch); `anchor` is where to open the composer. */
  onCreateAt: (at: number, anchor: AnchorRect) => void;
  /** A card (or a stack) was clicked. */
  onOpenCard: (card: PlacedCard<UiAnnotation>, anchor: AnchorRect) => void;
}

export interface TicketTimelineProps {
  header: TicketTimelineHeader;
  model: TimelineModel | null;
  filters: TimelineFilters;
  onToggleFilter: (key: TimelineFilterKey) => void;
  onAction: (action: TimelineAction, event: TimelineEvent) => void;
  /** Omitted → no annotation band at all (e.g. a read-only host). */
  annotations?: TimelineAnnotationsProps;
  /** Total content height (band + frieze), so the host can make room for it. */
  onContentHeight?: (height: number) => void;
  /** Horizontal zoom of the frieze (ZOOM_LEVELS); `onZoom` omitted → no zoom control. */
  zoom?: number;
  onZoom?: (zoom: number) => void;
  /**
   * Room (px) the host gives the annotation band above the frieze: it picks
   * two rows, one row (more stacking) or pills only. Omitted → as tall as needed.
   */
  maxBandHeight?: number;
}

const rectOf = (el: Element): AnchorRect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

export function TicketTimeline({ header, model, filters, onToggleFilter, onAction, annotations, onContentHeight, zoom = 1, onZoom, maxBandHeight }: TicketTimelineProps) {
  const viewport = useRef<HTMLDivElement>(null);
  // Viewport width: a short frieze is stretched to fill it.
  const [viewportW, setViewportW] = useState(0);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    setViewportW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => (model ? layoutTimeline(model, filters, viewportW, zoom) : null), [model, filters, viewportW, zoom]);
  const anchors = useMemo(() => (layout && model ? timeAnchors(layout, model.now) : []), [layout, model]);
  const band = useMemo(
    () =>
      layout && annotations
        ? layoutAnnotationBand(annotations.list, anchors, layout.width, filters.annotations, maxBandHeight == null ? 2 : rowsForBudget(maxBandHeight))
        : { cards: [], height: 0, mode: 'cards' as const },
    [layout, annotations, anchors, filters.annotations, maxBandHeight],
  );
  const bandH = band.height;
  const contentH = bandH + GEOMETRY.height;
  useEffect(() => onContentHeight?.(contentH), [contentH, onContentHeight]);
  const content = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<CursorInstant | null>(null);
  const pinnedRight = useRef(true);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Pinned to "now": on open, and on growth while the user sits at the right edge.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el || !layout) return;
    if (pinnedRight.current) {
      el.scrollLeft = el.scrollWidth;
      setScrollLeft(el.scrollLeft);
    }
  }, [layout?.width, layout]);

  const onScroll = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    pinnedRight.current = el.scrollWidth - el.scrollLeft - el.clientWidth <= STICK_SLACK;
    setScrollLeft(el.scrollLeft);
  }, []);

  // Vertical wheel → horizontal scroll (mouse users); trackpads send deltaX already.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ←/→ walk the pictos and annotation cards chronologically (= left to right).
  const order = useMemo(() => {
    const nodes = layout?.items.map((i) => ({ id: i.event.id, x: i.x })) ?? [];
    for (const c of band.cards) nodes.push({ id: cardNodeId(c), x: c.kind === 'card' ? c.item.x : c.items[0]!.x });
    return nodes.sort((a, b) => a.x - b.x).map((n) => n.id);
  }, [layout, band]);
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const id = (e.target as HTMLElement).dataset?.timelineNode;
      if (!id) return;
      // A on a focused picto: annotate its exact instant.
      if (annotations && filters.annotations && (e.key === 'a' || e.key === 'A') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const placed = layout?.byId.get(id);
        if (!placed) return;
        e.preventDefault();
        annotations.onCreateAt(placed.event.at, rectOf(e.target as HTMLElement));
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const idx = order.indexOf(id);
      if (idx < 0) return;
      const nodes = new Map<string, HTMLElement>();
      viewport.current?.querySelectorAll<HTMLElement>('[data-timeline-node]').forEach((n) => nodes.set(n.dataset.timelineNode!, n));
      for (let j = idx + (e.key === 'ArrowRight' ? 1 : -1); j >= 0 && j < order.length; j += e.key === 'ArrowRight' ? 1 : -1) {
        const btn = nodes.get(order[j]!);
        if (btn) {
          e.preventDefault();
          btn.focus();
          return;
        }
      }
    },
    [order, annotations, filters.annotations, layout],
  );

  // Hover → the instant under the cursor: in the band's create strip (below the cards and
  // pills, so the "+" never covers them), or on the frieze with ⌥ held. Only the "+" creates.
  const canAnnotate = !!annotations && filters.annotations && !!layout;
  const cursorAt = (e: React.MouseEvent): { x: number; y: number } | null => {
    const el = content.current;
    if (!el || !layout) return null;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < layout.spine.x0 - 12 || x > layout.nowX + 2) return null;
    return { x, y: e.clientY - r.top };
  };
  const onContentMove = (e: React.MouseEvent) => {
    if (!canAnnotate) return;
    const c = cursorAt(e);
    const overNode = (e.target as HTMLElement).closest('button');
    const show = c && (inCreateStrip(c.y, bandH) || (e.altKey && c.y >= bandH && !overNode));
    setGhost(show ? instantAtCursor(layout!, anchors, c.x) : null);
  };
  const onContentClick = (e: React.MouseEvent) => {
    if (!canAnnotate || (e.target as HTMLElement).closest('button')) return;
    const c = cursorAt(e);
    // A plain click in the band (e.g. to blur a card) must not annotate: only ⌥ + click does.
    if (!c || !e.altKey) return;
    const hit = instantAtCursor(layout!, anchors, c.x);
    const r = content.current!.getBoundingClientRect();
    annotations!.onCreateAt(hit.at, { left: r.left + hit.x - 1, top: r.top + ghostTop(bandH), width: 2, height: 22 });
  };

  const eventsById = useMemo(() => new Map(model?.events.map((e) => [e.id, e]) ?? []), [model]);
  const fork = model?.pendingFork && layout?.byId.get(model.pendingFork.anchorId) ? model.pendingFork : null;
  const forkFrom = fork ? layout!.byId.get(fork.anchorId)!.x : 0;

  return (
    <div className="flex h-full min-h-0 w-full" data-testid="ticket-timeline">
      {/* ── Fixed column ── */}
      <aside
        className="flex shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-[var(--theme-border)] px-3 py-2.5"
        style={{ width: COLUMN_W }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <TicketTypeIconSvg type={(header.type as TicketType | null) ?? null} size={15} className="shrink-0" />
            <span className="text-[15px] font-semibold text-[var(--theme-text-primary)]">
              {header.number != null ? `#${header.number}` : 'Ticket'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {onZoom && <TimelineZoomControl zoom={zoom} onZoom={onZoom} />}
            <TimelineFilterMenu filters={filters} onToggleFilter={onToggleFilter} />
          </div>
        </div>
        <div className="truncate text-[13px] text-[var(--theme-text-primary)]" title={header.title}>{header.title}</div>
        <div className="truncate text-[11px] text-[var(--theme-text-muted)]">
          {[header.boardName, TICKET_STATUS_LABELS[header.status] ?? header.status].filter(Boolean).join(' · ')}
        </div>
        <div className="mt-0.5 border-t border-dashed border-[var(--theme-border-input)]" />
        <TimelineTimeSummary summary={model?.summary ?? null} />
        {filters.pr && model && model.undatedPrs.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1" title="PR sans date connue">
            <span className="text-[10px] text-[var(--theme-text-faint)]">PR sans date :</span>
            <PrBadgeGroup
              density="full"
              prs={model.undatedPrs.flatMap((pr) => {
                const parsed = parseGithubPrRef(pr.ref);
                if (!parsed) return [];
                return [{
                  ...parsed,
                  href: pr.url || undefined,
                  title: pr.title ?? pr.ref,
                  state: pr.state === 'draft' || !pr.state ? 'open' as const : pr.state,
                  isDraft: pr.state === 'draft',
                }];
              })}
            />
          </div>
        )}
      </aside>

      {/* ── Scrolling frieze ── */}
      <div
        ref={viewport}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="relative flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden"
        aria-label="Frise chronologique du ticket"
        role="region"
      >
        {!layout || !model ? (
          <div className="px-4 text-[12px] text-[var(--theme-text-faint)]">Chargement de la timeline…</div>
        ) : (
          <div
            ref={content}
            data-testid="timeline-content"
            className="relative shrink-0"
            style={{ width: layout.width, height: contentH }}
            onMouseMove={onContentMove}
            onMouseLeave={() => setGhost(null)}
            onClick={onContentClick}
          >
          {bandH > 0 && <AnnotationAnchors band={band} width={layout.width} />}
          <div className="absolute left-0" style={{ top: bandH, width: layout.width, height: GEOMETRY.height }}>
            <TimelineZoneBands zones={layout.zones} fadeFrom={layout.nowX} />
            <TimelineOutOfLifeBand zones={layout.zones} closedAt={model.summary.closedAt} />

            <svg className="pointer-events-none absolute inset-0" width={layout.width} height={GEOMETRY.height} aria-hidden>
              {layout.days.map((d) => (
                <g key={`day-${d.x}`}>
                  <line x1={d.x} y1={GEOMETRY.statusY + 22} x2={d.x} y2={GEOMETRY.height} stroke="var(--theme-border-input)" strokeOpacity={0.5} />
                  <text x={d.x + 4} y={GEOMETRY.topY - 3} fontSize={10} fill="var(--theme-text-muted)">{d.label}</text>
                </g>
              ))}

              {/* Spine: neutral, tinted where agents worked. */}
              <line x1={layout.spine.x0} y1={GEOMETRY.spineY} x2={layout.spine.x1} y2={GEOMETRY.spineY} stroke="var(--theme-border-input)" strokeWidth={4} strokeLinecap="round" />
              {layout.spine.active && (
                <line
                  x1={layout.spine.active.x0}
                  y1={GEOMETRY.spineY}
                  x2={layout.spine.active.x1}
                  y2={GEOMETRY.spineY}
                  stroke={layout.spine.active.workflow ? 'var(--tint-orange-solid)' : 'var(--tint-purple-solid)'}
                  strokeOpacity={0.8}
                  strokeWidth={4}
                  strokeLinecap="round"
                />
              )}
              {layout.breaks.map((b) => (
                <g key={`break-${b.x}`}>
                  <rect x={b.x - 9} y={GEOMETRY.spineY - 4} width={18} height={8} fill="var(--theme-bg-surface)" />
                  <text x={b.x} y={GEOMETRY.noteY + 10} fontSize={10} textAnchor="middle" fill="var(--theme-text-muted)">{b.label}</text>
                </g>
              ))}

              {/* Dotted connectors: every top / bottom picto hangs from the spine (thin, drawn
                  under the labels so text always reads on top). */}
              {layout.items.map((it) => {
                const e = it.event;
                if (e.lane !== 'top' && e.lane !== 'bottom') return null;
                const stroke = `var(--tint-${glyphHue(e.glyph)}-solid)`;
                const [y1, y2] = e.lane === 'bottom'
                  ? [GEOMETRY.spineY + 2, GEOMETRY.bottomY + (e.kind === 'pr' ? 2 : 0)]
                  : [GEOMETRY.topY + 28, GEOMETRY.spineY - 2];
                return (
                  <line
                    key={`link-${e.id}`}
                    data-testid="timeline-connector"
                    x1={it.x} y1={y1} x2={it.x} y2={y2}
                    stroke={stroke} strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.7}
                  />
                );
              })}

              {fork && <TimelineForkCurves fork={fork} fromX={forkFrom} nowX={layout.nowX} />}

              <line x1={layout.nowX} y1={14} x2={layout.nowX} y2={GEOMETRY.height} stroke="var(--theme-text-muted)" strokeDasharray="3 3" />
              <text x={layout.nowX + 4} y={11} fontSize={10} fontFamily="ui-monospace, monospace" fill="var(--theme-text-muted)">maintenant</text>
            </svg>

            <TimelineZonePills
              zones={layout.zones}
              events={eventsById}
              scrollLeft={scrollLeft}
              viewportWidth={viewportW}
              nowX={layout.nowX}
            />
            <TimelineZoneMetrics zones={layout.zones} scrollLeft={scrollLeft} viewportWidth={viewportW} nowX={layout.nowX} />

            {layout.items.map((it) =>
              it.event.lane === 'spine' ? (
                <SpineNode key={it.event.id} item={it} onAction={onAction} />
              ) : it.event.lane === 'status' ? null : (
                <LanePicto key={it.event.id} item={it} onAction={onAction} />
              ),
            )}

            {fork && <TimelineForkOptions fork={fork} nowX={layout.nowX} />}
          </div>
          {annotations && (
            <TimelineAnnotationBand
              band={band}
              width={layout.width}
              ghost={ghost}
              highlight={annotations.highlight}
              onOpenCard={(card, el) => annotations.onOpenCard(card, rectOf(el))}
              onCreate={(at, el) => annotations.onCreateAt(at, rectOf(el))}
            />
          )}
          </div>
        )}
      </div>
    </div>
  );
}
