import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AgendaItem } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { AgendaChip, AgentSubline, ChipBadges, ChipName, GroupChipLabel, WaitHatches, WorkflowSubline, useAgendaColors, useHoverOpen, type OnOpen } from './AgendaChip';
import { chipStyle, dotStyle, groupMatch, statusHue, type AgendaColors, type SearchMatch } from './agendaLabels';
import {
  HOUR_PX, LANES_MAX_SHARE, LANE_PX, MAX_COLS, addDays, assignLanes, dayKey, formatDuration, groupHourly, isBand, isBar, itemDays, layoutDay, minutesOfDay, openWait, segmentForDay, startOfDay, workflowShortName, type DaySegment,
} from './agendaLayout';
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon } from '../ui/icons/AgendaIcons';
import { DragWrap, SlotPreview, useAgendaDnd } from './AgendaDnd';
import { canDrag, canResize } from './agendaDrag';

/** Gap kept around every rectangle, so two neighbours never touch. */
const GAP_PX = 1;
const WEEKDAY = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' });

interface Props {
  days: Date[];
  items: AgendaItem[];
  now: Date;
  match: (item: AgendaItem) => SearchMatch;
  onOpen: OnOpen;
  onOpenTicket: (item: AgendaItem) => void;
  onPickDay: (day: Date) => void;
  /**
   * A18: a click on an empty all-day cell. (A click / drag on an empty slot of
   * the hour grid goes through the drag controller's `onSelect`.)
   */
  onCreateAllDay?: (dayKey: string) => void;
}

/** Day / Week: an all-day band (due dates, 3+ day bars) over a 24-hour grid. */
export function AgendaTimeGrid({ days, items, now, match, onOpen, onOpenTicket, onPickDay, onCreateAllDay }: Props) {
  const dnd = useAgendaDnd();
  const preview = dnd?.preview ?? null;
  const colors = useAgendaColors();
  // A block over several days is one item drawn in several columns: hovering
  // any of its pieces lights them all.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverOpen = useHoverOpen();
  const hoverProps = (id: string) => ({
    onMouseEnter: () => setHoverId(id),
    onMouseLeave: () => setHoverId((h) => (h === id ? null : h)),
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const todayKey = dayKey(now);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const firstKey = dayKey(first);
  const lastKey = dayKey(last);
  const maxCols = days.length === 1 ? MAX_COLS.day : MAX_COLS.week;

  // Scroll so "now − 3 h" (or 07:00 on another week) is at the top, once per period.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showsToday = days.some((d) => dayKey(d) === todayKey);
    el.scrollTop = (showsToday ? Math.max(0, now.getHours() - 3) : 7) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, days.length]);

  const bars = useMemo(
    () => items.filter((it) => isBar(it, now)).filter((it) => {
      const ds = itemDays(it, now);
      return ds[0]! <= lastKey && ds[ds.length - 1]! >= firstKey;
    }),
    [items, now, firstKey, lastKey],
  );

  const perDay = days.map((d) => {
    const key = dayKey(d);
    const allDay = items.filter((it) => it.shape === 'allDay' && itemDays(it, now).includes(key));
    const segs = items.map((it) => segmentForDay(it, d, now)).filter((s): s is NonNullable<typeof s> => s !== null);
    // Workflow and agent runs get their own thin lanes; everything else shares what is left.
    const lanes = assignLanes(segs.filter((s) => isBand(s.item)));
    const others = segs.filter((s) => !isBand(s.item));
    const count = items.filter((it) => itemDays(it, now).includes(key)).length;
    return { day: d, key, allDay, lanes, entries: layoutDay(groupHourly(others), maxCols), count };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers */}
      <div className="grid shrink-0 border-b border-[var(--theme-border)]" style={{ gridTemplateColumns: cols }}>
        <div />
        {perDay.map(({ day, key, count }) => (
          <div key={key} className={cn('px-1 py-1 text-center text-[10.5px] uppercase tracking-wide', key === todayKey ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]')}>
            {WEEKDAY(day)}{' '}
            <button
              type="button"
              onClick={() => onPickDay(day)}
              className={cn('inline-block h-7 w-7 rounded-full text-base font-medium normal-case', key === todayKey ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]' : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]')}
            >
              {day.getDate()}
            </button>
            <div className="text-[10px] normal-case text-[var(--theme-text-faint)]">{count} items</div>
          </div>
        ))}
      </div>

      {/* All-day band */}
      <div className="grid max-h-52 shrink-0 overflow-y-auto border-b border-[var(--theme-border)]" style={{ gridTemplateColumns: cols }}>
        <div className="pr-1.5 pt-1 text-right text-[10px] text-[var(--theme-text-faint)]">all-day</div>
        {bars.length > 0 && (
          <>
            <div className="col-span-full col-start-2 grid gap-0.5 py-0.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {bars.map((it) => {
                const ds = itemDays(it, now);
                const s = Math.max(0, days.findIndex((d) => dayKey(d) >= ds[0]!));
                let e = days.findIndex((d) => dayKey(d) > ds[ds.length - 1]!);
                if (e < 0) e = days.length;
                const from = new Date(Math.max(new Date(it.start).getTime(), first.getTime()));
                const to = new Date(Math.min((it.end ? new Date(it.end) : now).getTime(), addDays(startOfDay(last), 1).getTime()));
                return (
                  <button
                    key={it.id}
                    type="button"
                    data-agenda-item={it.id}
                    onClick={(ev) => onOpen({ item: it }, ev.currentTarget)}
                    onDoubleClick={() => onOpenTicket(it)}
                    {...hoverOpen({ item: it })}
                    className={cn('relative flex min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-[11px] leading-4 hover:brightness-125')}
                    data-agenda-match={match(it)}
                    style={{ ...chipStyle(it, colors, match(it)), gridColumn: `${s + 1} / ${e + 1}`, ...(it.type === 'routine.run' ? { borderColor: 'var(--tint-red-solid)', background: 'var(--tint-red-bg)' } : {}) }}
                    title={it.title}
                  >
                    <WaitHatches item={it} from={from} to={to} now={now} vertical={false} />
                    {ds[0]! < firstKey && <ChevronLeftIcon size={11} className="relative shrink-0" />}
                    <span className="relative flex min-w-0 items-center gap-1"><ChipName item={it} /></span>
                    {it.type === 'workflow.run' && <span className="relative shrink-0"><WorkflowSubline item={it} now={now} /></span>}
                    {it.type === 'agent.run' && <span className="relative shrink-0"><AgentSubline item={it} now={now} /></span>}
                    {it.type === 'routine.run' && <span className="relative shrink-0 text-[10px] text-[var(--tint-red-text)]">stuck {it.status}</span>}
                    <span className="relative flex items-center gap-1"><ChipBadges item={it} /></span>
                  </button>
                );
              })}
            </div>
            <div />
          </>
        )}
        {perDay.map(({ key, allDay }) => (
          <div
            key={key}
            data-agenda-day={key}
            onClick={(e) => { if (e.target === e.currentTarget) onCreateAllDay?.(key); }}
            title={onCreateAllDay ? 'Click to add an all-day event' : undefined}
            className={cn(
              'flex min-h-6 min-w-0 flex-col gap-0.5 border-l border-[var(--theme-border)] p-0.5',
              preview?.dayKey === key && preview.startMin === null && 'bg-[var(--theme-bg-overlay)] outline-2 -outline-offset-2 outline-dashed outline-[var(--theme-accent)]',
            )}
          >
            {allDay.map((it) => <DragWrap key={it.id} item={it}><AgendaChip item={it} onOpen={onOpen} match={match(it)} /></DragWrap>)}
          </div>
        ))}
      </div>

      {/* Hour grid */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: HOUR_PX * 24 }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-[var(--theme-text-faint)]" style={{ top: (i + 1) * HOUR_PX }}>
                {String(i + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {perDay.map(({ key, day, entries, lanes }) => {
            const n = lanes.lanes;
            // One lane is at most LANE_PX wide and all of them at most LANES_MAX_SHARE of the column.
            const laneW = n ? `min(${LANE_PX}px, ${(LANES_MAX_SHARE * 100) / n}%)` : '0px';
            const lanesW = n ? `min(${n * LANE_PX}px, ${LANES_MAX_SHARE * 100}%)` : '0px';
            return (
            <div
              key={key}
              data-agenda-col={key}
              onPointerDown={(e) => { if (e.target === e.currentTarget && dnd) dnd.beginSelect(e, key); }}
              className={cn(
                'relative border-l border-[var(--theme-border)]',
                (day.getDay() === 0 || day.getDay() === 6) && 'bg-[var(--theme-bg-hover)]',
                preview?.dayKey === key && preview.startMin === null && 'outline-2 -outline-offset-2 outline-dashed outline-[var(--theme-accent)]',
              )}
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--theme-border) ${HOUR_PX - 1}px, var(--theme-border) ${HOUR_PX}px)` }}
            >
              {lanes.placed.map(({ seg, lane }) => (
                <WorkflowBand
                  key={seg.item.id}
                  seg={seg}
                  now={now}
                  colors={colors}
                  hovered={hoverId === seg.item.id}
                  hoverProps={hoverProps(seg.item.id)}
                  match={match(seg.item)}
                  style={{
                    top: (seg.startMin / 60) * HOUR_PX + GAP_PX,
                    height: Math.max(1, ((seg.endMin - seg.startMin) / 60) * HOUR_PX - 2 * GAP_PX),
                    left: `calc(${laneW} * ${lane} + ${GAP_PX}px)`,
                    width: `calc(${laneW} - ${GAP_PX}px)`,
                  }}
                  onOpen={onOpen}
                  onOpenTicket={onOpenTicket}
                />
              ))}
              {entries.map((e) => {
                const top = (e.startMin / 60) * HOUR_PX + GAP_PX;
                const height = Math.max(1, ((e.endMin - e.startMin) / 60) * HOUR_PX - 2 * GAP_PX);
                // Side by side: each entry owns its columns, nothing is drawn over anything.
                const pos = {
                  top,
                  height,
                  left: `calc(${lanesW} + (100% - ${lanesW}) * ${e.col / e.cols} + ${GAP_PX}px)`,
                  width: `calc((100% - ${lanesW}) * ${e.span / e.cols} - ${2 * GAP_PX}px)`,
                };
                if (e.kind === 'more') {
                  return (
                    <button
                      key={`m-${e.startMin}-${e.items[0]!.id}`}
                      type="button"
                      data-agenda-more={e.items.length}
                      onClick={(ev) => onOpen({ group: e.items }, ev.currentTarget)}
                      {...hoverOpen({ group: e.items })}
                      title={`${e.items.length} more`}
                      className="absolute flex items-center justify-center overflow-hidden rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-1 text-[10.5px] font-semibold text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]"
                      style={pos}
                    >
                      +{e.items.length}
                    </button>
                  );
                }
                if (e.kind === 'group') {
                  const it0 = e.items[0]!;
                  return (
                    <button
                      key={`g-${it0.id}`}
                      type="button"
                      onClick={(ev) => onOpen({ group: e.items }, ev.currentTarget)}
                      {...hoverOpen({ group: e.items })}
                      className={cn('absolute flex items-center gap-1 overflow-hidden rounded px-1.5 text-[11px] leading-4 hover:brightness-125')}
                      data-agenda-match={groupMatch(e.items, match)}
                      style={{ ...chipStyle(it0, colors, groupMatch(e.items, match)), ...pos }}
                    >
                      <GroupChipLabel items={e.items} />
                    </button>
                  );
                }
                const { seg } = e;
                const it = seg.item;
                const compact = height < 34;
                const draggable = !!dnd && canDrag(it);
                return (
                  <button
                    key={it.id}
                    type="button"
                    data-agenda-item={it.id}
                    onClick={(ev) => onOpen({ item: it }, ev.currentTarget)}
                    onDoubleClick={() => onOpenTicket(it)}
                    onPointerDown={draggable ? (ev) => dnd.beginItem(ev, it, 'move') : undefined}
                    {...hoverOpen({ item: it }, hoverProps(it.id))}
                    data-agenda-hovered={hoverId === it.id || undefined}
                    className={cn(
                      'absolute flex overflow-hidden rounded px-1.5 text-left text-[11px] leading-4 hover:brightness-125',
                      hoverId === it.id && 'brightness-125 ring-1 ring-[var(--theme-text-primary)]',
                      draggable ? 'cursor-grab' : 'cursor-pointer',
                      dnd?.draggingId === it.id && 'opacity-40',
                      compact ? 'flex-row items-center gap-1' : 'flex-col',
                      seg.continuesAfter && 'rounded-b-none',
                      seg.continuesBefore && 'rounded-t-none',
                    )}
                    data-agenda-match={match(it)}
                    style={{ ...chipStyle(it, colors, match(it)), ...pos }}
                    title={it.title}
                  >
                    {it.shape === 'block' && <WaitHatches item={it} from={seg.from} to={seg.to} now={now} vertical />}
                    <span className="relative flex w-full min-w-0 items-center gap-1">
                      {seg.continuesBefore && (
                        <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--theme-text-muted)]">
                          <ArrowUpIcon size={10} /> cont.
                        </span>
                      )}
                      <ChipName item={it} />
                      <ChipBadges item={it} />
                    </span>
                    {!compact && it.type === 'workflow.run' && <span className="relative w-full"><WorkflowSubline item={it} now={now} /></span>}
                    {!compact && it.shape === 'block' && !isBand(it) && e.span === e.cols && (
                      <span className="relative text-[10px] text-[var(--theme-text-muted)]">
                        {new Date(it.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} - {it.end ? new Date(it.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'now'}
                      </span>
                    )}
                    {seg.continuesAfter && <ArrowDownIcon size={10} className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[var(--theme-text-secondary)]" />}
                    {draggable && canResize(it) && !seg.continuesAfter && (
                      <span
                        aria-hidden
                        data-agenda-resize={it.id}
                        title="Drag to change the end"
                        onPointerDown={(ev) => { ev.stopPropagation(); dnd.beginItem(ev, it, 'resize'); }}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      />
                    )}
                  </button>
                );
              })}
              {preview?.dayKey === key && <SlotPreview preview={preview} refused={dnd?.refused ?? false} />}
              {key === todayKey && (
                <div className="pointer-events-none absolute -left-px right-0 z-50 h-0.5 bg-[var(--tint-red-solid)]" style={{ top: (minutesOfDay(now) / 60) * HOUR_PX }}>
                  <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--tint-red-solid)]" />
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * A workflow run in the hour grid: a thin band (≤ LANE_PX) with its ticket
 * number written vertically and its human waits hatched. The full name, the
 * workflow and the current wait are in the tooltip and the popover.
 */
function WorkflowBand({ seg, now, colors, hovered, hoverProps, match, style, onOpen, onOpenTicket }: {
  seg: DaySegment;
  now: Date;
  colors: AgendaColors;
  hovered: boolean;
  hoverProps: { onMouseEnter: () => void; onMouseLeave: () => void };
  match: SearchMatch;
  style: CSSProperties;
  onOpen: OnOpen;
  onOpenTicket: (item: AgendaItem) => void;
}) {
  const it = seg.item;
  const hoverOpen = useHoverOpen();
  const wait = openWait(it);
  const agent = it.type === 'agent.run' ? it.agent : null;
  const tip = [
    it.ticket ? `#${it.ticket.displayId} ${it.ticket.title}` : it.title,
    agent
      ? [agent.personaName ?? 'Agent', agent.model, formatDuration((it.end ? new Date(it.end) : now).getTime() - new Date(it.start).getTime()), it.status].filter(Boolean).join(' · ')
      : [workflowShortName(it.workflowName), wait ? `waiting at ${wait.stepName}` : it.status].filter(Boolean).join(' · '),
  ].join('\n');
  return (
    <button
      type="button"
      data-agenda-item={it.id}
      data-agenda-band
      data-agenda-hovered={hovered || undefined}
      onClick={(ev) => onOpen({ item: it }, ev.currentTarget)}
      onDoubleClick={() => onOpenTicket(it)}
      {...hoverOpen({ item: it }, hoverProps)}
      className={cn(
        'absolute flex cursor-pointer flex-col items-center overflow-hidden rounded-sm pt-0.5 hover:brightness-125',
        hovered && 'brightness-125 ring-1 ring-[var(--theme-text-primary)]',
        seg.continuesAfter && 'rounded-b-none',
        seg.continuesBefore && 'rounded-t-none',
      )}
      data-agenda-match={match}
      style={{ ...chipStyle(it, colors, match), borderLeftWidth: 1, ...style }}
      title={tip}
    >
      <WaitHatches item={it} from={seg.from} to={seg.to} now={now} vertical />
      <span className={cn('relative h-1.5 w-1.5 shrink-0 rounded-full', it.status === 'running' && 'animate-pulse')} style={dotStyle(statusHue(it.status))} />
      <span className="relative mt-0.5 text-[10px] font-bold leading-none tabular-nums [writing-mode:vertical-rl]">
        {it.ticket ? `#${it.ticket.displayId}` : agent ? (agent.personaName ?? 'Agent') : workflowShortName(it.workflowName)}
      </span>
      <span className="sr-only">{it.ticket?.title ?? it.title}</span>
    </button>
  );
}
