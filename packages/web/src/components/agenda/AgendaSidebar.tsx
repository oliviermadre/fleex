import { useMemo, useState } from 'react';
import type { AgendaItemType, AgendaPrefs } from '@fleex/shared';
import { DEFAULT_AGENDA_PREFS } from '@fleex/shared';
import { useAgendaStore } from '../../stores/agendaStore';
import { useTicketStore } from '../../stores/ticketStore';
import { MultiSelect } from '../ui/MultiSelect';
import { cn } from '../../lib/cn';
import { AGENDA_LABELS, FAMILIES, colorToken, itemHue, labelHue, routineColorKey, type AgendaColor } from './agendaLabels';
import type { AgendaItem } from '@fleex/shared';
import { AgendaColorPicker, AgendaInlineColorPicker } from './AgendaColorPicker';
import { LabelIcon } from './AgendaChip';
import { AgendaSavedViews } from './AgendaSavedViews';
import { AgendaGoogleSection } from './AgendaGoogleSection';
import { AgendaSidebarMenu } from './AgendaSidebarMenu';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ReopenIcon } from '../ui/icons/AgendaIcons';
import { MinusIcon } from '../ui/icons/TodoIcons';
import { addDays, dayKey, isoWeek, labelOn, startOfDay, weekStart, windowFor } from './agendaLayout';

function Check({ state, hue }: { state: 'on' | 'off' | 'mixed'; hue?: AgendaColor }) {
  const color = hue ? colorToken(hue, 'solid') : 'var(--theme-text-secondary)';
  return (
    <span
      className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] text-[9px] font-black text-[var(--theme-bg-base)]"
      style={{ border: `1.5px solid ${color}`, background: state === 'off' ? 'transparent' : color }}
    >
      {state === 'on' ? <CheckIcon size={10} className="[stroke-width:3]" /> : state === 'mixed' ? <MinusIcon size={10} className="[stroke-width:3]" /> : null}
    </span>
  );
}

function MiniCalendar() {
  const { anchor, prefs, goToDay } = useAgendaStore();
  const [month, setMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const start = weekStart(month);
  const { from, to } = windowFor(prefs.view, anchor);
  const todayKey = dayKey(new Date());
  return (
    <div className="select-none text-[11px]">
      <div className="mb-1 flex items-center justify-between font-semibold text-[var(--theme-text-primary)]">
        <button type="button" className="rounded px-1.5 hover:bg-[var(--theme-bg-overlay)]" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeftIcon size={12} /></button>
        <span>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="rounded px-1.5 hover:bg-[var(--theme-bg-overlay)]" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRightIcon size={12} /></button>
      </div>
      <div className="grid grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] text-center">
        <div />
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="py-0.5 text-[10px] text-[var(--theme-text-faint)]">{d}</div>)}
        {Array.from({ length: 6 }, (_, row) => {
          const monday = addDays(start, row * 7);
          return [
            <div
              key={`w${row}`}
              data-agenda-week-number
              title={`Week ${isoWeek(monday)}`}
              className={cn(
                'flex h-6 items-center justify-center bg-[var(--theme-bg-overlay)] text-[10px] font-medium text-[var(--theme-text-muted)]',
                row === 0 && 'rounded-t-md',
                row === 5 && 'rounded-b-md',
              )}
            >
              {isoWeek(monday)}
            </div>,
            ...Array.from({ length: 7 }, (_, col) => {
              const d = addDays(monday, col);
              const k = dayKey(d);
              const inRange = prefs.view !== 'schedule' && d >= from && d < to;
              const isToday = k === todayKey;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => goToDay(startOfDay(d))}
                  aria-current={isToday ? 'date' : undefined}
                  className={cn('group flex h-6 items-center justify-center', inRange && 'bg-[var(--theme-accent-muted)]')}
                >
                  <span
                    className={cn(
                      'flex h-[22px] w-[22px] items-center justify-center rounded-full',
                      isToday
                        ? 'bg-[var(--theme-accent)] font-semibold text-[var(--theme-accent-fg)]'
                        : cn(
                            'group-hover:bg-[var(--theme-bg-overlay)]',
                            d.getMonth() !== month.getMonth() ? 'text-[var(--theme-text-faint)]' : 'text-[var(--theme-text-secondary)]',
                          ),
                    )}
                  >
                    {d.getDate()}
                  </span>
                </button>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}

/**
 * /agenda's left panel: mini calendar, saved views, labels (the per-routine
 * checkboxes and the Google Calendar settings sit in a menu at the right of
 * their row, so the sidebar stays short), and the
 * board / epic / repo / tag filters. Every change is saved server-side.
 */
export function AgendaSidebar() {
  const { data, prefs, updatePrefs } = useAgendaStore();
  const boards = useTicketStore((s) => s.boards);

  const counts = useMemo(() => {
    const byType = new Map<AgendaItemType, number>();
    const byRoutine = new Map<string, number>();
    for (const it of data?.items ?? []) {
      byType.set(it.type, (byType.get(it.type) ?? 0) + 1);
      if (it.routine) byRoutine.set(it.routine.id, (byRoutine.get(it.routine.id) ?? 0) + 1);
    }
    return { byType, byRoutine };
  }, [data]);
  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const it of data?.items ?? []) for (const t of it.ticket?.tags ?? []) s.add(t);
    return [...s].sort();
  }, [data]);
  const epics = useMemo(() => {
    const known = new Map((data?.epics ?? []).map((e) => [e.id, e.name]));
    // A selected epic missing from this window keeps its row, so it can be unticked.
    for (const id of prefs.filters.epics) if (!known.has(id)) known.set(id, id);
    return [...known].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data, prefs.filters.epics]);
  const repos = useMemo(() => {
    const s = new Set<string>(prefs.filters.repos);
    for (const it of data?.items ?? []) for (const r of it.ticket?.repos ?? []) s.add(r);
    return [...s].sort();
  }, [data, prefs.filters.repos]);
  const setFilter = (key: keyof AgendaPrefs['filters'], v: string[]) =>
    updatePrefs((p: AgendaPrefs) => ({ ...p, filters: { ...p.filters, [key]: v } }));

  const setLabels = (types: AgendaItemType[], on: boolean) =>
    updatePrefs((p) => ({ ...p, labels: { ...p.labels, ...Object.fromEntries(types.map((t) => [t, on])) } }));
  const google = useAgendaStore((s) => s.google);
  const googleError = useAgendaStore((s) => s.data?.errors?.external ?? null) || google?.error || null;
  const routines = data?.routines ?? [];
  const hiddenRoutines = routines.filter((r) => prefs.routines[r.id] === false).length;
  const setAllRoutines = (on: boolean) =>
    updatePrefs((p) => ({ ...p, routines: on ? {} : Object.fromEntries(routines.map((r) => [r.id, false])) }));
  const toggleRoutine = (id: string) =>
    updatePrefs((p) => ({ ...p, routines: { ...p.routines, [id]: p.routines[id] === false } }));
  const colors = prefs.colors;
  const setColor = (key: string, hue: AgendaColor | null) =>
    updatePrefs((p) => {
      const next = { ...p.colors };
      if (hue) next[key] = hue;
      else delete next[key];
      return { ...p, colors: next };
    });
  const routineHue = (id: string) => itemHue({ type: 'routine.run', routine: { id } } as AgendaItem, colors);
  const isDirty = Object.keys(prefs.labels).length > 0
    || Object.keys(prefs.routines).length > 0
    || (Object.keys(DEFAULT_AGENDA_PREFS.filters) as (keyof AgendaPrefs['filters'])[]).some((k) => (prefs.filters[k]?.length ?? 0) > 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-2.5 py-3 text-xs">
      <MiniCalendar />
      <AgendaSavedViews />
      <div className="mt-4 mb-1 text-[10.5px] uppercase tracking-wide text-[var(--theme-text-muted)]">Filters</div>
      <div className="space-y-1.5">
        <MultiSelect
          label="Boards"
          values={prefs.filters.boards}
          options={boards.map((b) => ({ value: b.id, label: `${b.emoji ?? ''} ${b.name}`.trim() }))}
          onChange={(v) => setFilter('boards', v)}
        />
        <MultiSelect
          label="Epics"
          values={prefs.filters.epics}
          options={epics}
          onChange={(v) => setFilter('epics', v)}
        />
        <MultiSelect
          label="Repos"
          values={prefs.filters.repos}
          options={repos.map((r) => ({ value: r, label: r }))}
          onChange={(v) => setFilter('repos', v)}
        />
        <MultiSelect
          label="Tags"
          values={prefs.filters.tags}
          options={tags.map((t) => ({ value: t, label: t }))}
          onChange={(v) => setFilter('tags', v)}
        />
        <div className="text-[11px] text-[var(--theme-text-faint)]">Items without the field (routine runs, events, meetings, PRs without a ticket) stay visible.</div>
      </div>
      {isDirty && (
        <button
          type="button"
          className="mt-3 self-start text-[var(--theme-accent)]"
          onClick={() => updatePrefs((p) => ({ ...p, labels: {}, routines: {}, filters: { ...DEFAULT_AGENDA_PREFS.filters } }))}
        >
          <span className="inline-flex items-center gap-1"><ReopenIcon size={12} /> Reset labels &amp; filters</span>
        </button>
      )}

      <div className="mt-4 mb-1 text-[10.5px] uppercase tracking-wide text-[var(--theme-text-muted)]">Labels</div>
      {FAMILIES.map((fam) => {
        const labels = AGENDA_LABELS.filter((l) => l.family === fam.key);
        const on = labels.filter((l) => labelOn(prefs, l.type)).length;
        return (
          <div key={fam.key} className="mb-1">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setLabels(labels.map((l) => l.type), on !== labels.length)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 font-semibold text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]"
              >
                <Check state={on === labels.length ? 'on' : on === 0 ? 'off' : 'mixed'} />
                {fam.label}
              </button>
              {fam.key === 'routines' && routines.length > 0 && (
                <AgendaSidebarMenu label="Choose the routines to show" hint={hiddenRoutines ? `${hiddenRoutines} hidden` : null}>
                  <div className="mb-1 flex items-center gap-2 px-1 text-[10.5px] uppercase tracking-wide text-[var(--theme-text-muted)]">
                    <span className="flex-1">Routines</span>
                    <button type="button" className="normal-case text-[var(--theme-accent)] hover:underline" onClick={() => setAllRoutines(true)}>All</button>
                    <button type="button" className="normal-case text-[var(--theme-accent)] hover:underline" onClick={() => setAllRoutines(false)}>None</button>
                  </div>
                  {routines.map((r) => {
                    const isOn = prefs.routines[r.id] !== false;
                    return (
                      <div key={r.id} className="group flex flex-wrap items-center">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isOn}
                          onClick={() => toggleRoutine(r.id)}
                          title={r.name}
                          className={cn('flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--theme-bg-hover)]', isOn ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]')}
                        >
                          <Check state={isOn ? 'on' : 'off'} hue={routineHue(r.id)} />
                          <LabelIcon type="routine.run" routineId={r.id} />
                          <span className="flex-1 truncate text-left">{r.name}</span>
                          <span className="tabular-nums text-[10.5px] text-[var(--theme-text-faint)]">{counts.byRoutine.get(r.id) ?? 0}</span>
                        </button>
                        <AgendaInlineColorPicker
                          name={r.name}
                          hue={routineHue(r.id)}
                          custom={!!colors[routineColorKey(r.id)]}
                          onPick={(h) => setColor(routineColorKey(r.id), h)}
                        />
                      </div>
                    );
                  })}
                </AgendaSidebarMenu>
              )}
            </div>
            {labels.map((l) => {
              const isOn = labelOn(prefs, l.type);
              return (
                <div key={l.type} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => setLabels([l.type], !isOn)}
                    className={cn('flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 pl-6 pr-1 hover:bg-[var(--theme-bg-hover)]', isOn ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]')}
                  >
                    <Check state={isOn ? 'on' : 'off'} hue={labelHue(l.type, colors)} />
                    <LabelIcon type={l.type} />
                    <span className="flex-1 truncate text-left">{l.label}</span>
                    <span className="tabular-nums text-[10.5px] text-[var(--theme-text-faint)]">{counts.byType.get(l.type) ?? 0}</span>
                  </button>
                  <AgendaColorPicker
                    name={l.label}
                    hue={labelHue(l.type, colors)}
                    custom={!!colors[l.type]}
                    onPick={(h) => setColor(l.type, h)}
                  />
                  {l.type === 'external' && google && (
                    <AgendaSidebarMenu
                      label="Google Calendar settings"
                      hint={!google.connected ? 'Set up' : googleError ? 'Error' : null}
                      hintTone="warning"
                    >
                      <AgendaGoogleSection />
                    </AgendaSidebarMenu>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

    </div>
  );
}
