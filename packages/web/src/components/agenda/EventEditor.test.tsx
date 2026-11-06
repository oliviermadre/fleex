import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { CalendarEvent, Ticket } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  fetchTickets: vi.fn(),
  fetchAgenda: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import * as api from '../../services/api';
import { toast } from '../../lib/toast';
import { EventEditor, draftForAllDay, draftForRange, draftFromEvent, draftToInput } from './EventEditor';
import { AgendaEventActions } from './AgendaEventActions';
import { ticketsToSchedule } from './AgendaDrawer';
import { useTicketStore } from '../../stores/ticketStore';
import { useAgendaStore, withLocalEvent } from '../../stores/agendaStore';

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'ev1', title: 'Standup', description: 'daily sync', allDay: false,
  start: new Date(2026, 10, 2, 9).toISOString(), end: new Date(2026, 10, 2, 9, 30).toISOString(),
  color: 'purple', ticketId: null, epicId: 'ep1', recurrence: null, recurrenceUntil: null, createdAt: '', updatedAt: '', ...over,
});

beforeEach(() => {
  vi.mocked(api.createCalendarEvent).mockImplementation(async (input) => ({ ...ev(), ...input, id: 'new' } as CalendarEvent));
  vi.mocked(api.updateCalendarEvent).mockResolvedValue(ev());
  vi.mocked(api.deleteCalendarEvent).mockResolvedValue(undefined);
  vi.mocked(api.fetchTickets).mockResolvedValue([]);
  vi.mocked(api.fetchAgenda).mockResolvedValue({ from: '', to: '', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} });
  useTicketStore.setState({ tickets: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<EventEditor/> — create', () => {
  it('"Events label" shows the label colour picked in the sidebar and clears an event colour', async () => {
    const prev = useAgendaStore.getState().prefs;
    useAgendaStore.setState({ prefs: { ...prev, colors: { event: '#f43f5e' } } });
    render(<EventEditor draft={draftFromEvent(ev({ color: 'teal' }))} event={ev({ color: 'teal' })} onClose={() => {}} />);
    const def = screen.getByRole('button', { name: 'Default colour' });
    expect(def.getAttribute('aria-pressed')).toBe('false');
    expect((def.querySelector('span') as HTMLElement).style.background).toBe('rgb(244, 63, 94)');
    fireEvent.click(def);
    expect(def.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateCalendarEvent).toHaveBeenCalled());
    expect(vi.mocked(api.updateCalendarEvent).mock.calls[0]![1]).toMatchObject({ color: null });
    useAgendaStore.setState({ prefs: prev });
  });

  it('posts an all-day event with its inclusive last day', async () => {
    const onClose = vi.fn();
    render(<EventEditor draft={draftForAllDay('2026-11-10')} event={null} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Offsite ' } });
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-11-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createCalendarEvent).toHaveBeenCalledWith({
      title: 'Offsite', allDay: true, start: '2026-11-10', end: '2026-11-12', description: null, color: null,
      ticketId: null, epicId: null, recurrence: null, recurrenceUntil: null,
    });
    expect(toast.success).toHaveBeenCalledWith('"Offsite" created');
  });

  it('posts a timed weekly event with its colour and end of series', async () => {
    render(<EventEditor draft={draftForRange('2026-11-10', 600, 675)} event={null} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Colour pink' }));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('Until (optional)'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Sprint review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.createCalendarEvent).toHaveBeenCalled());
    expect(vi.mocked(api.createCalendarEvent).mock.calls[0]![0]).toEqual({
      title: 'Review', allDay: false,
      start: new Date(2026, 10, 10, 10, 0).toISOString(), end: new Date(2026, 10, 10, 11, 15).toISOString(),
      description: 'Sprint review', color: 'pink', ticketId: null, epicId: null, recurrence: 'weekly', recurrenceUntil: '2026-12-31',
    });
  });

  it('shows the created event in the agenda at once, without waiting for the refetch', async () => {
    // The full refetch reads tickets, runs, the event log and Google: seconds on a
    // real instance. Here it never answers — the event must still be there.
    vi.mocked(api.fetchAgenda).mockReturnValue(new Promise(() => {}));
    useAgendaStore.setState({ data: { from: '2026-11-09T00:00:00.000Z', to: '2026-11-16T00:00:00.000Z', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} } });
    const onClose = vi.fn();
    render(<EventEditor draft={draftForRange('2026-11-10', 600, 660)} event={null} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useAgendaStore.getState().data!.items).toEqual([expect.objectContaining({ id: 'event:new', type: 'event', title: 'Demo', shape: 'block' })]);
    expect(api.fetchAgenda).toHaveBeenCalled();
  });

  it('shows the validation inline and posts nothing', async () => {
    render(<EventEditor draft={draftForRange('2026-11-10', 600, 660)} event={null} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-11-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Give the event a title')).toBeTruthy();
    expect(screen.getByText('The end must be after the start')).toBeTruthy();
    expect(api.createCalendarEvent).not.toHaveBeenCalled();
  });
});

describe('<EventEditor/> — edit', () => {
  it('prefills from the series, says the whole series changes, and PATCHes it', async () => {
    const series = ev({ recurrence: 'daily' });
    render(<EventEditor draft={draftFromEvent(series)} event={series} onClose={() => {}} />);
    expect(screen.getByText(/changes apply to the whole series/)).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Standup');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Standup v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateCalendarEvent).toHaveBeenCalled());
    expect(vi.mocked(api.updateCalendarEvent).mock.calls[0]).toEqual(['ev1', expect.objectContaining({
      title: 'Standup v2', start: series.start, end: series.end, color: 'purple', epicId: 'ep1', recurrence: 'daily', description: 'daily sync',
    })]);
    expect(toast.success).toHaveBeenCalledWith('Event updated (whole series)');
  });
});

describe('draftToInput', () => {
  it('round-trips an all-day event', () => {
    const e = ev({ allDay: true, start: '2026-11-02', end: '2026-11-04' });
    expect(draftToInput(draftFromEvent(e)).input).toMatchObject({ allDay: true, start: '2026-11-02', end: '2026-11-04' });
  });

  it('ends a slot at midnight on the next day', () => {
    expect(draftForRange('2026-11-10', 1380, 1440)).toMatchObject({ startTime: '23:00', endDay: '2026-11-11', endTime: '00:00' });
  });
});

describe('<AgendaEventActions/>', () => {
  it('deletes a one-off event at once and offers an Undo that recreates it', async () => {
    const e = ev();
    const onClose = vi.fn();
    render(<AgendaEventActions item={{ id: 'event:ev1', type: 'event', shape: 'block', start: e.start, end: e.end, title: e.title, event: e }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(api.deleteCalendarEvent).toHaveBeenCalledWith('ev1');
    const [msg, opts] = vi.mocked(toast.info).mock.calls[0]!;
    expect(msg).toBe('"Standup" deleted');
    opts!.action!.onClick();
    await waitFor(() => expect(api.createCalendarEvent).toHaveBeenCalledWith({
      title: 'Standup', allDay: false, start: e.start, end: e.end, description: 'daily sync', color: 'purple',
      ticketId: null, epicId: 'ep1', recurrence: null, recurrenceUntil: null,
    }));
  });
});

describe('ticketsToSchedule (drawer)', () => {
  const t = (id: string, over: Partial<Ticket> = {}) => ({
    id, displayId: Number(id.slice(1)), title: `Ticket ${id}`, boardId: 'b1', status: 'todo', tags: [], dueDate: null,
    archivedAt: null, updatedAt: '2026-11-01', epics: [], ...over,
  }) as unknown as Ticket;
  const none = { boards: [], epics: [], tags: [] };

  it('keeps open tickets without a due date, through the board / epic / tag filters and the search', () => {
    const list = [
      t('t1'), t('t2', { status: 'done' }), t('t3', { status: 'cancelled' }), t('t4', { dueDate: '2026-11-10T12:00:00Z' }),
      t('t5', { archivedAt: '2026-11-01' }), t('t6', { boardId: 'b2' }), t('t7', { tags: ['ux'] }),
      t('t8', { epics: [{ id: 'e1' } as never] }),
    ];
    expect(ticketsToSchedule(list, none, '').map((x) => x.id).sort()).toEqual(['t1', 't6', 't7', 't8']);
    expect(ticketsToSchedule(list, { ...none, boards: ['b1'] }, '').map((x) => x.id).sort()).toEqual(['t1', 't7', 't8']);
    expect(ticketsToSchedule(list, { ...none, tags: ['api'] }, '').map((x) => x.id)).not.toContain('t7');
    expect(ticketsToSchedule(list, { ...none, epics: ['e2'] }, '').map((x) => x.id)).not.toContain('t8');
    expect(ticketsToSchedule(list, none, '#7').map((x) => x.id)).toEqual(['t7']);
    expect(ticketsToSchedule(list, none, '', new Set(['t1'])).map((x) => x.id)).not.toContain('t1');
  });
});

describe('withLocalEvent', () => {
  const data = (items: import('@fleex/shared').AgendaItem[] = []) => ({
    from: '2026-11-02T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z', generatedAt: '', items, routines: [], truncated: [], epics: [], errors: {},
  });
  const daily = ev({ id: 'd', recurrence: 'daily', start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T08:15:00.000Z', recurrenceUntil: '2026-11-04' });

  it('expands a series over the loaded window, like the server', () => {
    const out = withLocalEvent(data(), 'd', daily);
    expect(out.items.map((i) => i.id)).toEqual([
      'event:d:2026-11-02T08:00:00.000Z', 'event:d:2026-11-03T08:00:00.000Z', 'event:d:2026-11-04T08:00:00.000Z',
    ]);
  });

  it('replaces an edited event and keeps its attached deliverables; a delete removes it and nothing else', () => {
    const other = { id: 'ticket.created:x', type: 'ticket.created', shape: 'point', start: '2026-11-03T10:00:00.000Z', title: 'x' } as const;
    const links = [{ id: 'l', provider: 'fleex', eventKey: 'fleex-event:ev1', deliverableId: 'd', deliverableTitle: 'Notes', eventTitle: '', eventStart: '', source: 'manual', createdAt: '' }] as import('@fleex/shared').AgendaExternalLink[];
    const before = withLocalEvent(data([other]), 'ev1', ev());
    const linked = { ...before, items: before.items.map((i) => (i.id === 'event:ev1' ? { ...i, eventLinks: links } : i)) };
    const edited = withLocalEvent(linked, 'ev1', ev({ title: 'Renamed' }));
    expect(edited.items.find((i) => i.id === 'event:ev1')).toMatchObject({ title: 'Renamed', eventLinks: links });
    expect(withLocalEvent(edited, 'ev1', null).items.map((i) => i.id)).toEqual(['ticket.created:x']);
  });
});
