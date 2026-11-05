import { useEffect, useMemo, useRef } from 'react';
import type { AgendaItem } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { AgendaChip, ChipBadges, ChipName, WaitHatches, WorkflowSubline, type OnOpen } from './AgendaChip';
import { LABEL_BY_TYPE, chipStyle } from './agendaLabels';
import {
  addDays, dayKey, groupHourly, isBar, itemDays, layoutDay, minutesOfDay, segmentForDay, startOfDay,
} from './agendaLayout';

const HOUR_PX = 48;
const WEEKDAY = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' });

interface Props {
  days: Date[];
  items: AgendaItem[];
  now: Date;
  isHit: (item: AgendaItem) => boolean;
  onOpen: OnOpen;
  onOpenTicket: (item: AgendaItem) => void;
  onPickDay: (day: Date) => void;
}

/** Day / Week: an all-day band (due dates, 3+ day bars) over a 24-hour grid. */
export function AgendaTimeGrid({ days, items, now, isHit, onOpen, onOpenTicket, onPickDay }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const todayKey = dayKey(now);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const firstKey = dayKey(first);
  const lastKey = dayKey(last);

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
    const allDay = items.filter((it) => it.shape === 'allDay' && it.start === key);
    const segs = items.map((it) => segmentForDay(it, d, now)).filter((s): s is NonNullable<typeof s> => s !== null);
    const count = items.filter((it) => itemDays(it, now).includes(key)).length;
    return { day: d, key, allDay, entries: layoutDay(groupHourly(segs)), count };
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
                    className={cn('relative flex min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-[11px] leading-4 hover:brightness-125', !isHit(it) && 'opacity-25')}
                    style={{ ...chipStyle(it), gridColumn: `${s + 1} / ${e + 1}`, ...(it.type === 'routine.run' ? { borderColor: 'var(--tint-red-solid)', background: 'var(--tint-red-bg)' } : {}) }}
                    title={it.title}
                  >
                    <WaitHatches item={it} from={from} to={to} now={now} vertical={false} />
                    {ds[0]! < firstKey && <span className="relative">◂</span>}
                    <span className="relative flex min-w-0 items-center gap-1"><ChipName item={it} /></span>
                    {it.type === 'workflow.run' && <span className="relative shrink-0"><WorkflowSubline item={it} now={now} /></span>}
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
          <div key={key} className="flex min-h-6 min-w-0 flex-col gap-0.5 border-l border-[var(--theme-border)] p-0.5">
            {allDay.map((it) => <AgendaChip key={it.id} item={it} onOpen={onOpen} dimmed={!isHit(it)} />)}
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
          {perDay.map(({ key, day, entries }) => (
            <div
              key={key}
              className={cn('relative border-l border-[var(--theme-border)]', (day.getDay() === 0 || day.getDay() === 6) && 'bg-[var(--theme-bg-hover)]')}
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--theme-border) ${HOUR_PX - 1}px, var(--theme-border) ${HOUR_PX}px)` }}
            >
              {entries.map((e) => {
                const top = (e.startMin / 60) * HOUR_PX;
                const height = Math.max(18, ((e.endMin - e.startMin) / 60) * HOUR_PX) - 2;
                // Google-Calendar cascade: later columns shift right and sit on top.
                const step = e.cols > 1 ? Math.min(100 / e.cols, 22) : 0;
                const left = e.col * step;
                const pos = { top, height, left: `calc(${left}% + 2px)`, width: `calc(${100 - left}% - 4px)`, zIndex: 2 + e.col };
                if (e.kind === 'group') {
                  const it0 = e.items[0]!;
                  return (
                    <button
                      key={`g-${it0.id}`}
                      type="button"
                      onClick={(ev) => onOpen({ group: e.items }, ev.currentTarget)}
                      className={cn('absolute flex items-center gap-1 overflow-hidden rounded px-1.5 text-[11px] hover:brightness-125', !e.items.some(isHit) && 'opacity-25')}
                      style={{ ...chipStyle(it0), ...pos }}
                    >
                      <span className="shrink-0">{it0.routine?.emoji || LABEL_BY_TYPE[it0.type].icon}</span>
                      <span className="truncate">{it0.routine?.name ?? LABEL_BY_TYPE[it0.type].label}</span>
                      <span className="shrink-0 font-bold text-[var(--theme-text-secondary)]">×{e.items.length}</span>
                    </button>
                  );
                }
                const { seg } = e;
                const it = seg.item;
                const compact = height < 34;
                return (
                  <button
                    key={it.id}
                    type="button"
                    data-agenda-item={it.id}
                    onClick={(ev) => onOpen({ item: it }, ev.currentTarget)}
                    onDoubleClick={() => onOpenTicket(it)}
                    className={cn(
                      'absolute flex overflow-hidden rounded px-1.5 text-left text-[11px] leading-4 shadow-[-2px_0_0_var(--theme-bg-base)] hover:z-40 hover:brightness-125',
                      compact ? 'flex-row items-center gap-1' : 'flex-col',
                      seg.continuesAfter && 'rounded-b-none',
                      seg.continuesBefore && 'rounded-t-none',
                      !isHit(it) && 'opacity-25',
                    )}
                    style={{ ...chipStyle(it), ...pos }}
                    title={it.title}
                  >
                    {it.shape === 'block' && <WaitHatches item={it} from={seg.from} to={seg.to} now={now} vertical />}
                    <span className="relative flex w-full min-w-0 items-center gap-1">
                      {seg.continuesBefore && <span className="shrink-0 text-[10px] text-[var(--theme-text-muted)]">↑ cont.</span>}
                      <ChipName item={it} />
                      <ChipBadges item={it} />
                    </span>
                    {!compact && it.type === 'workflow.run' && <span className="relative w-full"><WorkflowSubline item={it} now={now} /></span>}
                    {!compact && it.shape === 'block' && it.type !== 'workflow.run' && (
                      <span className="relative text-[10px] text-[var(--theme-text-muted)]">
                        {new Date(it.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} – {it.end ? new Date(it.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'now'}
                      </span>
                    )}
                    {seg.continuesAfter && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] text-[var(--theme-text-secondary)]">↓</span>}
                  </button>
                );
              })}
              {key === todayKey && (
                <div className="pointer-events-none absolute -left-px right-0 z-50 h-0.5 bg-[var(--tint-red-solid)]" style={{ top: (minutesOfDay(now) / 60) * HOUR_PX }}>
                  <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--tint-red-solid)]" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
