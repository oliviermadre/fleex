import { useMemo, useState } from 'react';
import type { AgendaItemType, AgendaPrefs } from '@fleex/shared';
import { DEFAULT_AGENDA_PREFS } from '@fleex/shared';
import { useAgendaStore } from '../../stores/agendaStore';
import { useTicketStore } from '../../stores/ticketStore';
import { MultiSelect } from '../ui/MultiSelect';
import { cn } from '../../lib/cn';
import { AGENDA_LABELS, FAMILIES, LABEL_BY_TYPE } from './agendaLabels';
import { LabelIcon } from './AgendaChip';
import { AgendaSavedViews } from './AgendaSavedViews';
import { AgendaGoogleSection } from './AgendaGoogleSection';
import { AgendaSidebarMenu } from './AgendaSidebarMenu';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ReopenIcon } from '../ui/icons/AgendaIcons';
import { MinusIcon } from '../ui/icons/TodoIcons';
import { addDays, dayKey, labelOn, startOfDay, weekStart, windowFor } from './agendaLayout';

function Check({ state, hue }: { state: 'on' | 'off' | 'mixed'; hue?: string }) {
  const color = hue ? `var(--tint-${hue}-solid)` : 'var(--theme-text-secondary)';
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
      <div className="grid grid-cols-7 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="py-0.5 text-[10px] text-[var(--theme-text-faint)]">{d}</div>)}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i);
          const k = dayKey(d);
          const inRange = prefs.view !== 'schedule' && d >= from && d < to;
          return (
            <button
              key={k}
              type="button"
              onClick={() => goToDay(startOfDay(d))}
              className={cn(
                'h-6 rounded-full hover:bg-[var(--theme-bg-overlay)]',
                d.getMonth() !== month.getMonth() ? 'text-[var(--theme-text-faint)]' : 'text-[var(--theme-text-secondary)]',
                inRange && 'rounded-none bg-[var(--theme-accent-muted)]',
                k === todayKey && 'rounded-full bg-[var(--theme-accent)] font-semibold text-[var(--theme-accent-fg)]',
              )}
            >
              {d.getDate()}
            </button>
          );
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
  const isDirty = Object.keys(prefs.labels).length > 0
    || Object.keys(prefs.routines).length > 0
    || (Object.keys(DEFAULT_AGENDA_PREFS.filters) as (keyof AgendaPrefs['filters'])[]).some((k) => (prefs.filters[k]?.length ?? 0) > 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-2.5 py-3 text-xs">
      <MiniCalendar />
      <AgendaSavedViews />

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
                      <button
                        key={r.id}
                        type="button"
                        role="checkbox"
                        aria-checked={isOn}
                        onClick={() => toggleRoutine(r.id)}
                        title={r.name}
                        className={cn('flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--theme-bg-hover)]', isOn ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]')}
                      >
                        <Check state={isOn ? 'on' : 'off'} hue={LABEL_BY_TYPE['routine.run'].hue} />
                        <LabelIcon type="routine.run" />
                        <span className="flex-1 truncate text-left">{r.name}</span>
                        <span className="tabular-nums text-[10.5px] text-[var(--theme-text-faint)]">{counts.byRoutine.get(r.id) ?? 0}</span>
                      </button>
                    );
                  })}
                </AgendaSidebarMenu>
              )}
            </div>
            {labels.map((l) => {
              const isOn = labelOn(prefs, l.type);
              return (
                <div key={l.type} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setLabels([l.type], !isOn)}
                    className={cn('flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 pl-6 pr-1 hover:bg-[var(--theme-bg-hover)]', isOn ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]')}
                  >
                    <Check state={isOn ? 'on' : 'off'} hue={l.hue} />
                    <LabelIcon type={l.type} />
                    <span className="flex-1 truncate text-left">{l.label}</span>
                    <span className="tabular-nums text-[10.5px] text-[var(--theme-text-faint)]">{counts.byType.get(l.type) ?? 0}</span>
                  </button>
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

      <div className="mt-3 mb-1 text-[10.5px] uppercase tracking-wide text-[var(--theme-text-muted)]">Filters</div>
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
    </div>
  );
}
