/**
 * E1: create / edit a free event (A18), and delete one with Undo.
 *
 * The editor is a Modal hosted once by the page (`EventEditorHost`) and opened
 * from anywhere through `useEventEditor` — the item popover that offers
 * "Edit" closes itself first, so the form can't live inside it.
 * Free events are shared by the whole instance; a recurring event is edited
 * as a series.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import type { CalendarEvent, CalendarEventInput, CalendarEventRecurrence } from '@fleex/shared';
import * as api from '../../services/api';
import { toast } from '../../lib/toast';
import { TINT_HUES, type TintHue } from '../../lib/tints';
import { cn } from '../../lib/cn';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Autocomplete } from '../ui/Autocomplete';
import { CheckIcon, RepeatIcon } from '../ui/icons/AgendaIcons';
import { useTicketStore } from '../../stores/ticketStore';
import { useAgendaStore } from '../../stores/agendaStore';
import { dayKey } from './agendaLayout';
import { shiftDayKey } from './agendaDrag';

// ── Draft ⇄ input (pure) ──

export interface EventDraft {
  title: string;
  allDay: boolean;
  /** 'YYYY-MM-DD'. */
  startDay: string;
  /** All-day: the inclusive last day. Timed: the day of the end instant. */
  endDay: string;
  /** 'HH:MM', local — ignored when all-day. */
  startTime: string;
  endTime: string;
  color: TintHue | null;
  ticketId: string | null;
  /** Kept as-is on edit (no picker yet). */
  epicId: string | null;
  description: string;
  recurrence: CalendarEventRecurrence | null;
  /** 'YYYY-MM-DD' or '' = forever. */
  recurrenceUntil: string;
}

export type DraftErrors = Partial<Record<'title' | 'end' | 'until', string>>;

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

const blank = (key: string): EventDraft => ({
  title: '', allDay: false, startDay: key, endDay: key, startTime: '09:00', endTime: '10:00',
  color: null, ticketId: null, epicId: null, description: '', recurrence: null, recurrenceUntil: '',
});

/** A timed draft on `key` from `startMin` to `endMin` (1440 = next midnight). */
export function draftForRange(key: string, startMin: number, endMin: number): EventDraft {
  return {
    ...blank(key),
    startTime: hhmm(startMin),
    endDay: endMin >= 1440 ? shiftDayKey(key, 1) : key,
    endTime: hhmm(endMin >= 1440 ? endMin - 1440 : endMin),
  };
}

export function draftForAllDay(key: string): EventDraft {
  return { ...blank(key), allDay: true };
}

export function draftFromEvent(ev: CalendarEvent): EventDraft {
  const base: EventDraft = {
    ...blank(ev.allDay ? ev.start : dayKey(new Date(ev.start))),
    title: ev.title, allDay: ev.allDay, color: (TINT_HUES as string[]).includes(ev.color ?? '') ? (ev.color as TintHue) : null,
    ticketId: ev.ticketId, epicId: ev.epicId, description: ev.description ?? '', recurrence: ev.recurrence,
    recurrenceUntil: ev.recurrenceUntil ?? '',
  };
  if (ev.allDay) return { ...base, startDay: ev.start, endDay: ev.end };
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  return {
    ...base, startDay: dayKey(s), endDay: dayKey(e),
    startTime: hhmm(s.getHours() * 60 + s.getMinutes()), endTime: hhmm(e.getHours() * 60 + e.getMinutes()),
  };
}

/** Validate a draft and build the API input. All-day `end` is the inclusive last day. */
export function draftToInput(d: EventDraft): { input: CalendarEventInput | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const title = d.title.trim();
  if (!title) errors.title = 'Give the event a title';
  let start: string;
  let end: string;
  if (d.allDay) {
    start = d.startDay;
    end = d.endDay || d.startDay;
    if (!start) errors.end = 'Pick a date';
    else if (end < start) errors.end = 'The last day is before the first one';
  } else {
    const s = new Date(`${d.startDay}T${d.startTime || '00:00'}`);
    const e = new Date(`${d.endDay || d.startDay}T${d.endTime || '00:00'}`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      errors.end = 'Pick a date and a time';
      start = end = '';
    } else {
      start = s.toISOString();
      end = e.toISOString();
      if (e <= s) errors.end = 'The end must be after the start';
    }
  }
  if (d.recurrence && d.recurrenceUntil && d.recurrenceUntil < d.startDay) errors.until = 'The series would end before it starts';
  if (Object.keys(errors).length) return { input: null, errors };
  return {
    errors,
    input: {
      title, allDay: d.allDay, start, end,
      description: d.description.trim() || null,
      color: d.color,
      ticketId: d.ticketId,
      epicId: d.epicId,
      recurrence: d.recurrence,
      recurrenceUntil: d.recurrence && d.recurrenceUntil ? d.recurrenceUntil : null,
    },
  };
}

/** Everything needed to recreate an event (Undo after a delete). */
export function eventToInput(ev: CalendarEvent): CalendarEventInput {
  return {
    title: ev.title, allDay: ev.allDay, start: ev.start, end: ev.end, description: ev.description, color: ev.color,
    ticketId: ev.ticketId, epicId: ev.epicId, recurrence: ev.recurrence, recurrenceUntil: ev.recurrenceUntil,
  };
}

/** `request()` already toasted an HTTP error; only a network failure still needs one. */
export function reportFailure(e: unknown, message: string): void {
  if (e instanceof Error && e.message.startsWith('API error')) return;
  toast.error(message, { detail: e instanceof Error ? e.message : String(e) });
}

const refreshAgenda = () => useAgendaStore.getState().refresh();

// ── Delete with Undo ──

export async function deleteEventWithUndo(ev: CalendarEvent): Promise<boolean> {
  try {
    await api.deleteCalendarEvent(ev.id);
  } catch (e) {
    reportFailure(e, "Couldn't delete the event");
    return false;
  }
  void refreshAgenda();
  toast.info(`"${ev.title}" deleted`, {
    action: {
      label: 'Undo',
      onClick: () => {
        api.createCalendarEvent(eventToInput(ev))
          .then(() => { toast.success(`"${ev.title}" restored`); return refreshAgenda(); })
          .catch((e: unknown) => reportFailure(e, "Couldn't restore the event"));
      },
    },
  });
  return true;
}

// ── Page-level store: which editor / confirmation is open ──

interface EditorTarget { draft: EventDraft; event: CalendarEvent | null }

interface EventEditorStore {
  editor: EditorTarget | null;
  deleting: CalendarEvent | null;
  openCreate: (draft: EventDraft) => void;
  openEdit: (event: CalendarEvent) => void;
  close: () => void;
  askDelete: (event: CalendarEvent) => void;
  cancelDelete: () => void;
}

export const useEventEditor = create<EventEditorStore>((set) => ({
  editor: null,
  deleting: null,
  openCreate: (draft) => set({ editor: { draft, event: null } }),
  openEdit: (event) => set({ editor: { draft: draftFromEvent(event), event } }),
  close: () => set({ editor: null }),
  askDelete: (event) => set({ deleting: event }),
  cancelDelete: () => set({ deleting: null }),
}));

// ── Form ──

const SWATCHES: (TintHue | null)[] = [null, 'teal', 'blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'gray'];
const REPEAT_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

const FieldError = ({ children }: { children?: ReactNode }) =>
  children ? <div role="alert" className="text-xs text-[var(--tint-red-text)]">{children}</div> : null;

/** Load the ticket list once if nobody did (the agenda page doesn't need it otherwise). */
export function useTicketsLoaded(): void {
  const empty = useTicketStore((s) => s.tickets.length === 0);
  useEffect(() => {
    if (!empty) return;
    Promise.resolve()
      .then(() => useTicketStore.getState().fetchTickets())
      .catch(() => { /* the request helper toasted; the picker just stays empty */ });
  }, [empty]);
}

export function EventEditor({ draft: initial, event, onClose }: { draft: EventDraft; event: CalendarEvent | null; onClose: () => void }) {
  const [d, setD] = useState<EventDraft>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const tickets = useTicketStore((s) => s.tickets);
  useTicketsLoaded();

  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const { input, errors } = draftToInput(d);
  const shown: DraftErrors = tried ? errors : {};
  const recurring = !!event?.recurrence;

  const ticketOptions = useMemo(
    () => tickets.filter((t) => !t.archivedAt).map((t) => ({ value: t.id, label: `#${t.displayId} ${t.title}` })),
    [tickets],
  );

  const toggleAllDay = (allDay: boolean) => setD((p) => {
    if (allDay) return { ...p, allDay, endDay: p.endDay < p.startDay ? p.startDay : p.endDay };
    const sameTimes = p.startTime >= p.endTime && p.endDay <= p.startDay;
    return { ...p, allDay, endDay: p.startDay, ...(sameTimes ? { startTime: '09:00', endTime: '10:00' } : {}) };
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!input || busy) return;
    setBusy(true);
    try {
      if (event) {
        await api.updateCalendarEvent(event.id, input);
        toast.success(recurring ? 'Event updated (whole series)' : 'Event updated');
      } else {
        await api.createCalendarEvent(input);
        toast.success(`"${input.title}" created`);
      }
      onClose();
      void refreshAgenda();
    } catch (err) {
      reportFailure(err, event ? "Couldn't update the event" : "Couldn't create the event");
    } finally {
      setBusy(false);
    }
  };

  const dateCls = 'w-full';
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 text-sm" aria-label={event ? 'Edit event' : 'New event'}>
      <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">{event ? 'Edit event' : 'New event'}</h2>
      {recurring && (
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] px-2 py-1 text-xs text-[var(--tint-blue-text)]">
          <RepeatIcon size={12} /> This event repeats: changes apply to the whole series.
        </div>
      )}
      <div>
        <Input id="ev-title" label="Title" value={d.title} autoFocus placeholder="Add a title" onChange={(e) => set('title', e.target.value)} />
        <FieldError>{shown.title}</FieldError>
      </div>

      <label className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
        <input type="checkbox" checked={d.allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
        All day
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Input id="ev-start-day" label={d.allDay ? 'First day' : 'Start'} type="date" className={dateCls} value={d.startDay}
          onChange={(e) => setD((p) => {
            const v = e.target.value;
            // Keep the length: moving the start drags the end along.
            const len = p.endDay && p.startDay ? Math.round((Date.parse(p.endDay) - Date.parse(p.startDay)) / 86_400_000) : 0;
            return { ...p, startDay: v, endDay: v ? shiftDayKey(v, Math.max(0, len)) : p.endDay };
          })} />
        {!d.allDay && <Input id="ev-start-time" label="at" type="time" step={900} className={dateCls} value={d.startTime} onChange={(e) => set('startTime', e.target.value)} />}
        <Input id="ev-end-day" label={d.allDay ? 'Last day' : 'End'} type="date" className={dateCls} value={d.endDay} onChange={(e) => set('endDay', e.target.value)} />
        {!d.allDay && <Input id="ev-end-time" label="at" type="time" step={900} className={dateCls} value={d.endTime} onChange={(e) => set('endTime', e.target.value)} />}
      </div>
      <FieldError>{shown.end}</FieldError>

      <div className="space-y-1">
        <div className="text-xs font-medium text-[var(--theme-text-secondary)]">Colour</div>
        <div className="flex flex-wrap gap-1.5">
          {SWATCHES.map((h) => (
            <button
              key={h ?? 'default'}
              type="button"
              aria-label={h ? `Colour ${h}` : 'Default colour'}
              aria-pressed={d.color === h}
              title={h ?? 'Default (Events label)'}
              onClick={() => set('color', h)}
              className={cn('flex h-5 w-5 items-center justify-center rounded-full border', d.color === h ? 'border-[var(--theme-text-primary)]' : 'border-transparent')}
              style={{ background: `var(--tint-${h ?? 'teal'}-${h ? 'solid' : 'bg'})` }}
            >
              {d.color === h && <CheckIcon size={11} className={h ? 'text-[var(--theme-accent-fg)]' : 'text-[var(--theme-text-primary)]'} />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <Autocomplete id="ev-ticket" label="Linked ticket (optional)" options={ticketOptions} value={d.ticketId ?? ''} onChange={(v) => set('ticketId', v || null)} placeholder="Search a ticket" />
        </div>
        {d.ticketId && <Button type="button" size="sm" variant="ghost" onClick={() => set('ticketId', null)}>Clear</Button>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="ev-desc" className="text-xs font-medium text-[var(--theme-text-secondary)]">Description</label>
        <textarea
          id="ev-desc"
          rows={3}
          value={d.description}
          onChange={(e) => set('description', e.target.value)}
          className="resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select id="ev-repeat" label="Repeat" options={REPEAT_OPTIONS} value={d.recurrence ?? ''} onChange={(e) => set('recurrence', (e.target.value || null) as CalendarEventRecurrence | null)} />
        {d.recurrence && <Input id="ev-until" label="Until (optional)" type="date" value={d.recurrenceUntil} onChange={(e) => set('recurrenceUntil', e.target.value)} />}
      </div>
      <FieldError>{shown.until}</FieldError>

      <div className="flex items-center justify-end gap-2 pt-1">
        <span className="mr-auto text-[11px] text-[var(--theme-text-muted)]">Shared with everyone on this Fleex.</span>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>{event ? 'Save' : 'Create'}</Button>
      </div>
    </form>
  );
}

/** Rendered once by the page: the editor modal and the "delete the series?" confirmation. */
export function EventEditorHost() {
  const { editor, deleting, close, cancelDelete } = useEventEditor();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Modal open={!!editor} onClose={close} maxWidth="max-w-md">
        {editor && <EventEditor key={editor.event?.id ?? `${editor.draft.startDay}-${editor.draft.startTime}`} draft={editor.draft} event={editor.event} onClose={close} />}
      </Modal>
      <ConfirmModal
        open={!!deleting}
        title="Delete this recurring event?"
        message={deleting ? <>"{deleting.title}" repeats {deleting.recurrence}: every occurrence of the series will be deleted.</> : null}
        confirmLabel="Delete the series"
        busy={busy}
        onCancel={cancelDelete}
        onConfirm={() => {
          if (!deleting) return;
          setBusy(true);
          void deleteEventWithUndo(deleting).finally(() => { setBusy(false); cancelDelete(); });
        }}
      />
    </>
  );
}
