import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgendaItem, AgendaView, Ticket } from '@fleex/shared';
import { useAgendaStore } from '../../stores/agendaStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useRoutineStore } from '../../stores/routineStore';
import * as api from '../../services/api';
import { toast } from '../../lib/toast';
import { appWs } from '../../services/websocket';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { useDismissBeforeCreate } from './useDismissBeforeCreate';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../lib/cn';
import { AgendaTimeGrid } from './AgendaTimeGrid';
import { AgendaMonth, AgendaSchedule } from './AgendaMonthAndSchedule';
import { AgendaItemDetails } from './AgendaItemDetails';
import { AgendaChip, type OpenTarget } from './AgendaChip';
import { ChevronLeftIcon, ChevronRightIcon, PanelRightIcon, PlusIcon } from '../ui/icons/AgendaIcons';
import { addDays, dayKey, isVisible, matchesQuery, windowFor } from './agendaLayout';
import { applyPlanToItem, dueDateFor, nextHalfHour, wallMinutes, type DropPlan } from './agendaDrag';
import { AgendaDndContext, DragGhost, useAgendaDndController, type SelectRange } from './AgendaDnd';
import { AgendaDrawer } from './AgendaDrawer';
import { EventEditorHost, draftForAllDay, draftForRange, reportFailure, useEventEditor } from './EventEditor';

const VIEWS: { key: AgendaView; label: string; hotkey: string }[] = [
  { key: 'day', label: 'Day', hotkey: 'd' },
  { key: 'week', label: 'Week', hotkey: 'w' },
  { key: 'month', label: 'Month', hotkey: 'm' },
  { key: 'schedule', label: 'Schedule', hotkey: 'a' },
];

function periodLabel(view: AgendaView, anchor: Date): string {
  const { from, to } = windowFor(view, anchor);
  if (view === 'day') return anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'month') return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const last = addDays(to, -1);
  const sameYear = from.getFullYear() === last.getFullYear();
  const a = from.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const b = last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${a} – ${b}`;
}

/** Re-render once a minute: the "now" line and running blocks grow. */
function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Optimistic changes laid over the server data until the write settles: a
 * moved chip (`match` → `apply`) or a ticket just dropped from the drawer
 * (`add`). Each one is removed once the write failed (rollback) or the
 * refetch brought the real thing.
 */
type Override = { match: (it: AgendaItem) => boolean; apply: (it: AgendaItem) => AgendaItem } | { add: AgendaItem };

function useOverrides() {
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const seq = useRef(0);
  const push = useCallback((o: Override) => {
    const id = ++seq.current;
    setOverrides((p) => ({ ...p, [id]: o }));
    return () => setOverrides((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }, []);
  return { overrides, push };
}

function applyOverrides(items: AgendaItem[], overrides: Record<number, Override>): AgendaItem[] {
  const list = Object.values(overrides);
  if (!list.length) return items;
  const out = items.map((it) => list.reduce((acc, o) => ('match' in o && o.match(acc) ? o.apply(acc) : acc), it));
  const adds = list.flatMap((o) => ('add' in o && !out.some((i) => i.id === o.add.id) ? [o.add] : []));
  return [...out, ...adds];
}

const dueItemFor = (t: Ticket, day: string): AgendaItem => ({
  id: `ticket.due:${t.id}`, type: 'ticket.due', shape: 'allDay', start: day, title: t.title,
  overdue: day < dayKey(new Date()),
  ticket: { id: t.id, displayId: t.displayId, title: t.title, boardId: t.boardId, status: t.status, tags: t.tags, epicIds: t.epics?.map((e) => e.id) ?? [], repos: [] },
});

const fmtDay = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Refetch the window when a run, routine or ticket changes. Bursts (a step
 * completes, the next starts…) coalesce into one request a second later.
 */
function useAgendaLiveUpdates(refresh: () => void) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = appWs.onChannel('tickets', (raw) => {
      if (!/^(workflow|routine|ticket|calendar_event):/.test(raw.type)) return;
      if (timer) return;
      timer = setTimeout(() => { timer = null; refresh(); }, 1000);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [refresh]);
}

export function AgendaPage() {
  const navigate = useNavigate();
  const { anchor, data, loading, error, prefs, prefsLoaded, query, init, refresh, setView, go, goToday, goToDay, setQuery, updatePrefs } = useAgendaStore();
  const now = useMinuteNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const pop = usePopover({ placement: 'right-start', gap: 6, role: 'dialog', open: target !== null, onOpenChange: (o) => { if (!o) setTarget(null); }, enableClick: false });
  useDismissBeforeCreate(target !== null, () => setTarget(null), () => pop.refs.floating.current);

  useEffect(() => { void init(); }, [init]);
  const stableRefresh = useCallback(() => { void refresh(); }, [refresh]);
  useAgendaLiveUpdates(stableRefresh);

  const { overrides, push: pushOverride } = useOverrides();
  const [scheduling, setScheduling] = useState<ReadonlySet<string>>(new Set());
  const visible = useMemo(
    () => applyOverrides(data?.items ?? [], overrides).filter((it) => isVisible(it, prefs)),
    [data, overrides, prefs],
  );
  const isHit = useCallback((it: AgendaItem) => matchesQuery(it, query), [query]);
  const hits = query ? visible.filter(isHit).length : null;

  const open = useCallback((t: OpenTarget, el: HTMLElement) => {
    pop.refs.setReference(el);
    setTarget(t);
  }, [pop.refs]);
  const openTicket = useCallback((it: AgendaItem) => {
    if (it.type !== 'workflow.run' || !it.ticket) return;
    setTarget(null);
    navigate(`/work/${it.ticket.id}`);
  }, [navigate]);
  const pickDay = useCallback((d: Date) => goToDay(d, 'day'), [goToDay]);

  // ── A18: create ──
  const createAt = useCallback((r: SelectRange) => useEventEditor.getState().openCreate(draftForRange(r.dayKey, r.startMin, r.endMin)), []);
  const createAllDay = useCallback((key: string) => useEventEditor.getState().openCreate(draftForAllDay(key)), []);
  const createNext = useCallback(() => {
    const at = nextHalfHour(new Date());
    const m = wallMinutes(at);
    useEventEditor.getState().openCreate(draftForRange(dayKey(at), m, m + 60));
  }, []);

  // ── Drag & drop: optimistic, rolled back when the write fails ──
  const onDrop = useCallback(async (plan: DropPlan) => {
    if (plan.kind === 'refused') {
      toast.error(plan.reason);
      return;
    }
    if (plan.kind === 'event') {
      const ev = plan.item.event!;
      // Only the version we moved: once the refetch brings the new series, it no longer matches.
      const undo = pushOverride({
        match: (it) => it.event?.id === ev.id && it.event.updatedAt === ev.updatedAt,
        apply: (it) => applyPlanToItem(plan, it),
      });
      try {
        await api.updateCalendarEvent(plan.eventId, plan.patch);
        const what = plan.edge === 'end' ? 'resized' : 'moved';
        toast.success(plan.series ? `"${ev.title}" ${what}: the whole series` : `"${ev.title}" ${what} to ${plan.preview.label}`);
        await refresh();
      } catch (e) {
        reportFailure(e, "Couldn't move the event");
      } finally {
        undo();
      }
      return;
    }
    if (plan.kind === 'due') {
      const day = plan.dayKey;
      const ticket = useTicketStore.getState().tickets.find((t) => t.id === plan.ticketId);
      let undo: () => void = () => {};
      if (plan.item) {
        const from = plan.item;
        undo = pushOverride({
          match: (it) => it.id === from.id && it.start === from.start,
          apply: (it) => ({ ...it, start: day, overdue: day < dayKey(new Date()) && it.ticket?.status !== 'done' && it.ticket?.status !== 'cancelled' }),
        });
      } else if (ticket) {
        undo = pushOverride({ add: dueItemFor(ticket, day) });
      }
      setScheduling((s) => new Set(s).add(plan.ticketId));
      try {
        await useTicketStore.getState().updateTicket(plan.ticketId, { dueDate: dueDateFor(day) });
        toast.success(`"${plan.title}" due ${fmtDay(day)}`);
        await refresh();
      } catch (e) {
        reportFailure(e, "Couldn't change the due date");
      } finally {
        undo();
        setScheduling((s) => { const n = new Set(s); n.delete(plan.ticketId); return n; });
      }
      return;
    }
    // A one-off routine: its single `once` instant moves.
    const trig = useRoutineStore.getState().routines.find((r) => r.id === plan.routineId)?.trigger;
    const timezone = trig && trig.kind !== 'manual' ? trig.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const from = plan.item;
    const undo = pushOverride({ match: (it) => it.id === from.id, apply: (it) => ({ ...it, start: plan.runAt }) });
    try {
      await api.updateRoutine(plan.routineId, { trigger: { kind: 'once', runAt: plan.runAt, timezone } });
      toast.success(`"${from.title}" rescheduled to ${plan.preview.label}`);
      await refresh();
    } catch (e) {
      reportFailure(e, "Couldn't reschedule the routine");
    } finally {
      undo();
    }
  }, [pushOverride, refresh]);

  const { api: dnd, ghost, refused } = useAgendaDndController({ now, onDrop: (p) => void onDrop(p), onSelect: createAt });

  // Keyboard: ← → period, t today, d/w/m/a views, / search — never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (useEventEditor.getState().editor || useEventEditor.getState().deleting) return;
      if (e.key === 'c') { e.preventDefault(); createNext(); }
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 't') goToday();
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else {
        const v = VIEWS.find((x) => x.hotkey === e.key);
        if (v) setView(v.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, goToday, setView, createNext]);

  const { from } = windowFor(prefs.view, anchor);
  const days = prefs.view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(from, i));

  return (
    <AgendaDndContext.Provider value={dnd}>
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-[var(--theme-bg-base)]">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-3 py-2">
        <Button size="sm" variant="primary" onClick={createNext} title="Create an event (c)" className="inline-flex items-center gap-1">
          <PlusIcon size={13} /> Create
        </Button>
        <Button size="sm" onClick={goToday}>Today</Button>
        <Button size="sm" variant="ghost" onClick={() => go(-1)} title="Previous period (left arrow key)" aria-label="Previous"><ChevronLeftIcon size={14} /></Button>
        <Button size="sm" variant="ghost" onClick={() => go(1)} title="Next period (right arrow key)" aria-label="Next"><ChevronRightIcon size={14} /></Button>
        <span className="ml-1 whitespace-nowrap text-base font-semibold text-[var(--theme-text-primary)]">{periodLabel(prefs.view, anchor)}</span>
        <span className="rounded border border-[var(--theme-border)] px-1.5 text-[11px] text-[var(--theme-text-muted)]" title="The grid uses your browser's time zone">
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
        {loading && <Spinner size={12} />}
        <span className="rounded-full border border-[var(--theme-border)] px-2 text-[11px] text-[var(--theme-text-secondary)]">
          <b className="text-[var(--theme-text-primary)]">{visible.length}</b> visible
        </span>
        {error && <Button size="sm" variant="ghost" onClick={() => void refresh()}>Retry</Button>}
        <span className="flex-1" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
          placeholder="Search (/)"
          className="h-7 w-40 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 text-xs text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        />
        <div className="inline-flex rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              title={`${v.label} (${v.hotkey})`}
              className={cn('rounded-md px-2.5 py-0.5 text-xs', prefs.view === v.key ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={prefs.drawerOpen}
          onClick={() => updatePrefs((p) => ({ ...p, drawerOpen: !p.drawerOpen }))}
          title={prefs.drawerOpen ? 'Hide the tickets to schedule' : 'Show the open tickets without a due date'}
          className={cn('inline-flex items-center gap-1', prefs.drawerOpen && 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]')}
        >
          <PanelRightIcon size={13} /> To schedule
        </Button>
      </div>

      {query && (
        <div className="mx-3 mt-1.5 flex items-center gap-2 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-secondary)]">
          {hits ? `${hits} match${hits > 1 ? 'es' : ''} for “${query}” — the others are dimmed` : `No events match “${query}”`}
          <button type="button" className="text-[var(--theme-accent)]" onClick={() => setQuery('')}>Clear</button>
        </div>
      )}
      {data && data.truncated.length > 0 && (
        <div className="mx-3 mt-1.5 rounded-md border border-[var(--tint-yellow-border)] bg-[var(--tint-yellow-bg)] px-2 py-1 text-xs text-[var(--tint-yellow-text)]">
          Some high-frequency routines are not fully shown (capped at 500 upcoming occurrences).
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!prefsLoaded || !data ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--theme-text-muted)]">
              {error ? <span>{error}</span> : <Spinner size={16} />}
            </div>
          ) : prefs.view === 'month' ? (
            <AgendaMonth from={from} anchorMonth={anchor.getMonth()} items={visible} now={now} isHit={isHit} onOpen={open} onPickDay={pickDay} onCreateAllDay={createAllDay} />
          ) : prefs.view === 'schedule' ? (
            <AgendaSchedule items={visible} now={now} isHit={isHit} onOpen={open} />
          ) : (
            <AgendaTimeGrid days={days} items={visible} now={now} isHit={isHit} onOpen={open} onOpenTicket={openTicket} onPickDay={pickDay} onCreateAllDay={createAllDay} />
          )}
        </div>
        {prefsLoaded && prefs.drawerOpen && <AgendaDrawer hidden={scheduling} />}
      </div>

      {target && (
        <FloatingPortal>
          <div
            ref={pop.refs.setFloating}
            style={pop.floatingStyles}
            {...pop.getFloatingProps()}
            className="z-50 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] shadow-xl"
          >
            {'item' in target ? (
              <AgendaItemDetails item={target.item} now={now} onClose={() => setTarget(null)} />
            ) : (
              <div className="w-80 space-y-0.5 p-2">
                <div className="px-1 pb-1 text-xs font-semibold text-[var(--theme-text-primary)]">
                  {new Set(target.group.map((it) => `${it.type}|${it.routine?.id ?? ''}`)).size === 1
                    ? `${target.group[0]!.routine?.name ?? target.group[0]!.title} \u00d7${target.group.length}`
                    : `${target.group.length} items`}
                </div>
                {target.group.map((it) => (
                  <AgendaChip key={it.id} item={it} onOpen={(t) => setTarget(t)} dimmed={!isHit(it)} />
                ))}
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
      <EventEditorHost />
      <DragGhost ghost={ghost} refused={refused} />
    </div>
    </AgendaDndContext.Provider>
  );
}
