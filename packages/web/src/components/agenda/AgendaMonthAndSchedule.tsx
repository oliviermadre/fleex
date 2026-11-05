import type { AgendaItem } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { AgendaChip, GroupChipLabel, WaitIcon, type OnOpen } from './AgendaChip';
import { chipStyle } from './agendaLabels';
import { addDays, dayKey, isBar, itemDays, parseDayKey, workflowShortName, openWait } from './agendaLayout';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 4;

/** Group a day's items: one chip per item, except same-type (same-routine) runs → ×N. */
function dayGroups(items: AgendaItem[], now: Date): AgendaItem[][] {
  const groups = new Map<string, AgendaItem[]>();
  for (const it of items) {
    const single = it.shape === 'allDay' || isBar(it, now) || it.type === 'workflow.run';
    const key = single ? `one:${it.id}` : `${it.type}|${it.routine?.id ?? ''}`;
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }
  const rank = (g: AgendaItem[]) => (isBar(g[0]!, now) ? 0 : g[0]!.shape === 'allDay' ? 1 : 2);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || (a[0]!.start < b[0]!.start ? -1 : 1));
}

function GroupChip({ items, onOpen, dimmed }: { items: AgendaItem[]; onOpen: OnOpen; dimmed: boolean }) {
  const it0 = items[0]!;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen({ group: items }, e.currentTarget); }}
      className={cn('flex w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-[11px] leading-4 hover:brightness-125', dimmed && 'opacity-25')}
      style={chipStyle(it0)}
    >
      <GroupChipLabel items={items} />
    </button>
  );
}

export function AgendaMonth({ from, anchorMonth, items, now, isHit, onOpen, onPickDay }: {
  from: Date;
  anchorMonth: number;
  items: AgendaItem[];
  now: Date;
  isHit: (item: AgendaItem) => boolean;
  onOpen: OnOpen;
  onPickDay: (day: Date) => void;
}) {
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of items) for (const k of itemDays(it, now)) (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(it);
  const todayKey = dayKey(now);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-[var(--theme-border)]">
        {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5 text-[10.5px] uppercase text-[var(--theme-text-muted)]">{d}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-y-auto">
        {Array.from({ length: 42 }, (_, i) => {
          const day = addDays(from, i);
          const key = dayKey(day);
          const groups = dayGroups(byDay.get(key) ?? [], now);
          const shown = groups.slice(0, MAX_CHIPS);
          return (
            <div key={key} className={cn('flex min-h-24 min-w-0 flex-col gap-0.5 overflow-hidden border-b border-r border-[var(--theme-border)] p-1', day.getMonth() !== anchorMonth && 'bg-[var(--theme-bg-hover)]')}>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  className={cn('h-5 min-w-5 rounded-full px-1 text-xs', key === todayKey ? 'bg-[var(--theme-accent)] font-semibold text-[var(--theme-accent-fg)]' : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]')}
                >
                  {day.getDate()}
                </button>
                {groups.length > 0 && <span className="ml-auto text-[10px] text-[var(--theme-text-faint)]">{(byDay.get(key) ?? []).length}</span>}
              </div>
              {shown.map((g) => g.length === 1
                ? <AgendaChip key={g[0]!.id} item={g[0]!} onOpen={onOpen} dimmed={!isHit(g[0]!)} time={!isBar(g[0]!, now)} />
                : <GroupChip key={`${g[0]!.type}-${g[0]!.id}`} items={g} onOpen={onOpen} dimmed={!g.some(isHit)} />)}
              {groups.length > MAX_CHIPS && (
                <button type="button" onClick={() => onPickDay(day)} className="self-start rounded px-1 text-[11px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]">
                  +{groups.length - MAX_CHIPS} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Schedule: a chronological list, grouped by day, with a "now" rule today. */
export function AgendaSchedule({ items, now, isHit, onOpen }: {
  items: AgendaItem[];
  now: Date;
  isHit: (item: AgendaItem) => boolean;
  onOpen: OnOpen;
}) {
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of items) {
    const k = itemDays(it, now)[0]!;
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(it);
  }
  const keys = [...byDay.keys()].sort();
  const todayKey = dayKey(now);
  if (!keys.length) return <div className="p-6 text-sm text-[var(--theme-text-muted)]">Nothing in this period for the selected labels.</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
      {keys.map((k) => {
        const day = parseDayKey(k);
        const list = byDay.get(k)!;
        const groups = dayGroups(list, now);
        let nowShown = k !== todayKey;
        return (
          <div key={k} className="grid grid-cols-[110px_1fr] border-b border-[var(--theme-border)] py-2">
            <div className={cn('text-xs', k === todayKey ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]')}>
              <div className="text-xl font-medium text-[var(--theme-text-primary)]">{day.getDate()}</div>
              {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short' })}
            </div>
            <div className="space-y-0.5">
              {groups.map((g) => {
                const it0 = g[0]!;
                const marker = !nowShown && it0.shape !== 'allDay' && new Date(it0.start) > now;
                if (marker) nowShown = true;
                const wait = openWait(it0);
                return (
                  <div key={it0.id}>
                    {marker && <div className="my-1 border-t-2 border-[var(--tint-red-solid)] text-[10px] font-bold text-[var(--tint-red-text)]">now</div>}
                    {g.length > 1 ? (
                      <GroupChip items={g} onOpen={onOpen} dimmed={!g.some(isHit)} />
                    ) : (
                      <AgendaChip item={it0} onOpen={onOpen} dimmed={!isHit(it0)}>
                        {it0.type === 'workflow.run' && (
                          <span className="ml-1 shrink-0 text-[10.5px] text-[var(--theme-text-muted)]">
                            {workflowShortName(it0.workflowName)}
                            {wait && <> · <WaitIcon kind={wait.kind} className="align-[-1px]" /> {wait.stepName}</>}
                          </span>
                        )}
                      </AgendaChip>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
