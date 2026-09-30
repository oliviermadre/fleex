/**
 * The ticket Timeline frieze (SPEC §6): a fixed 232px column (ticket identity,
 * category filters, undatable PRs) beside a horizontally scrolling viewport.
 * The content band is 196px tall, drawn in two layers — an SVG for lines
 * (spine, connectors, now line, fork, day separators) and absolutely placed
 * HTML for everything focusable. Independent of WorkView (props only), so the
 * Kanban ticket detail can reuse it later.
 *
 * Scrolling: opens scrolled to "now"; new events keep the view pinned right
 * only if the user was already there; a vertical wheel scrolls horizontally;
 * ←/→ walk the pictos in chronological order.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TicketType } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { getPrBadgeClasses } from '../../../lib/prBadgeStyle';
import type { TimelineFilterKey } from '../../../stores/workStore';
import { TicketTypeIcon } from '../../tickets/TicketTypeBadge';
import { PrIcon } from '../queue/QueuePrGlyph';
import type { TimelineAction, TimelineEvent, TimelineModel } from './buildTimeline';
import { GEOMETRY, layoutTimeline, type TimelineFilters } from './layoutTimeline';
import { LanePicto, SpineNode } from './TimelineNode';
import { TimelineZoneBands, TimelineZonePills } from './TimelineZones';
import { TimelineForkCurves, TimelineForkOptions } from './TimelineFork';
import { glyphHue } from './TimelineGlyph';

const COLUMN_W = 232;
const STICK_SLACK = 40;

const FILTERS: { key: TimelineFilterKey; label: string }[] = [
  { key: 'status', label: 'Statuts' },
  { key: 'cli', label: 'CLI' },
  { key: 'pr', label: 'PR' },
  { key: 'deliverables', label: 'Livrables' },
  { key: 'comments', label: 'Commentaires' },
];

export interface TicketTimelineHeader {
  number: number | null;
  title: string;
  boardName: string | null;
  status: string;
  type: string | null;
}

export interface TicketTimelineProps {
  header: TicketTimelineHeader;
  model: TimelineModel | null;
  filters: TimelineFilters;
  onToggleFilter: (key: TimelineFilterKey) => void;
  onAction: (action: TimelineAction, event: TimelineEvent) => void;
}

export function TicketTimeline({ header, model, filters, onToggleFilter, onAction }: TicketTimelineProps) {
  const layout = useMemo(() => (model ? layoutTimeline(model, filters) : null), [model, filters]);
  const viewport = useRef<HTMLDivElement>(null);
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

  // ←/→ walk the pictos chronologically.
  const order = useMemo(() => layout?.items.map((i) => i.event.id) ?? [], [layout]);
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const id = (e.target as HTMLElement).dataset?.timelineNode;
      if (!id) return;
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
    [order],
  );

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
        <div className="flex items-center gap-2">
          <TicketTypeIcon type={(header.type as TicketType | null) ?? null} />
          <span className="text-[15px] font-semibold text-[var(--theme-text-primary)]">
            {header.number != null ? `#${header.number}` : 'Ticket'}
          </span>
        </div>
        <div className="truncate text-[13px] text-[var(--theme-text-primary)]" title={header.title}>{header.title}</div>
        <div className="truncate text-[11px] text-[var(--theme-text-muted)]">
          {[header.boardName, TICKET_STATUS_LABELS[header.status] ?? header.status].filter(Boolean).join(' · ')}
        </div>
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Filtres de la timeline">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filters[f.key]}
              onClick={() => onToggleFilter(f.key)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                filters[f.key]
                  ? 'border-[var(--theme-border-input)] bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
                  : 'border-transparent text-[var(--theme-text-faint)] line-through decoration-[var(--theme-text-faint)]/50',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {filters.pr && model && model.undatedPrs.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" title="PR sans date connue">
            {model.undatedPrs.map((pr) => (
              <a
                key={pr.ref}
                href={pr.url || undefined}
                target="_blank"
                rel="noreferrer"
                className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[11px]', getPrBadgeClasses({ state: pr.state === 'draft' || !pr.state ? 'open' : pr.state, isDraft: pr.state === 'draft' }))}
              >
                <PrIcon state={pr.state} />
                {pr.label}
              </a>
            ))}
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
          <div className="relative shrink-0" style={{ width: layout.width, height: GEOMETRY.height }}>
            <TimelineZoneBands zones={layout.zones} />

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

              {/* Dotted connectors: attached pictos ↔ spine, priority ↔ spine. */}
              {layout.items.map((it) => {
                const e = it.event;
                if (!(it.attached || e.kind === 'priority')) return null;
                const stroke = `var(--tint-${glyphHue(e.glyph)}-solid)`;
                const [y1, y2] = e.lane === 'bottom'
                  ? [GEOMETRY.spineY + 3, GEOMETRY.bottomY - 1]
                  : e.kind === 'priority'
                    ? [GEOMETRY.topY + 28, GEOMETRY.noteY - 2]
                    : [GEOMETRY.topY + 29, GEOMETRY.spineY - 3];
                return <line key={`link-${e.id}`} x1={it.x} y1={y1} x2={it.x} y2={y2} stroke={stroke} strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.9} />;
              })}

              {fork && <TimelineForkCurves fork={fork} fromX={forkFrom} nowX={layout.nowX} />}

              <line x1={layout.nowX} y1={14} x2={layout.nowX} y2={GEOMETRY.height} stroke="var(--theme-text-muted)" strokeDasharray="3 3" />
              <text x={layout.nowX + 4} y={11} fontSize={10} fontFamily="ui-monospace, monospace" fill="var(--theme-text-muted)">maintenant</text>
            </svg>

            <TimelineZonePills zones={layout.zones} events={eventsById} scrollLeft={scrollLeft} />

            {layout.items.map((it) =>
              it.event.lane === 'spine' ? (
                <SpineNode key={it.event.id} item={it} onAction={onAction} />
              ) : it.event.lane === 'status' ? null : (
                <LanePicto key={it.event.id} item={it} onAction={onAction} />
              ),
            )}

            {fork && <TimelineForkOptions fork={fork} nowX={layout.nowX} />}
          </div>
        )}
      </div>
    </div>
  );
}
