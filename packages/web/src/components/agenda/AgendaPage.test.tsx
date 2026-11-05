import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEFAULT_AGENDA_PREFS, type AgendaResponse } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgendaPrefs: vi.fn(),
  saveAgendaPrefs: vi.fn(),
  fetchAgenda: vi.fn(),
  fetchTickets: vi.fn(),
  updateTicket: vi.fn(),
  createCalendarEvent: vi.fn(),
}));
vi.mock('../../services/websocket', () => ({ appWs: { onChannel: () => () => {} } }));

import * as api from '../../services/api';
import { AgendaPage } from './AgendaPage';
import { useAgendaStore } from '../../stores/agendaStore';
import { useEventEditor } from './EventEditor';
import { addDays, dayKey, weekStart } from './agendaLayout';

// jsdom has no PointerEvent: without it fireEvent drops button / clientX.
if (typeof window.PointerEvent === 'undefined') {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {};
}

const now = new Date();
const at = (h: number, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).toISOString();
const ticket = { id: 'tk-765', displayId: 765, title: 'vue agenda dans routines', boardId: 'b', status: 'doing', tags: [], epicIds: [], repos: [] };

const response: AgendaResponse = {
  from: '', to: '', generatedAt: '', truncated: [], epics: [], errors: {},
  routines: [{ id: 'sync', name: 'Sync backlog', emoji: '' }],
  items: [
    {
      id: 'workflow.run:r1', type: 'workflow.run', shape: 'block', start: at(0, 30), end: at(1, 30), status: 'completed',
      title: ticket.title, ticket, workflowName: 'Spec Dev PR (HITL)', segments: [], runId: 'r1',
    },
    { id: 'routine.run:s1', type: 'routine.run', shape: 'block', start: at(0, 5), end: at(0, 6), status: 'completed', title: 'Sync backlog', routine: { id: 'sync', name: 'Sync backlog', emoji: '' } },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/agenda']}>
      <Routes>
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/work/:id" element={<div>task view</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAgendaStore.setState({ data: null, prefs: { ...DEFAULT_AGENDA_PREFS, view: 'day' }, prefsLoaded: false, query: '' });
  vi.mocked(api.fetchAgendaPrefs).mockResolvedValue({ ...DEFAULT_AGENDA_PREFS, view: 'day' });
  vi.mocked(api.fetchAgenda).mockResolvedValue(response);
  vi.mocked(api.fetchTickets).mockResolvedValue([]);
  vi.mocked(api.saveAgendaPrefs).mockResolvedValue(undefined as never);
  useEventEditor.setState({ editor: null, deleting: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<AgendaPage/>', () => {
  it('leads a workflow run with its ticket number, so two "Spec Dev PR" runs can be told apart', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('#765')).toBeTruthy());
    expect(screen.getAllByText('vue agenda dans routines').length).toBeGreaterThan(0);
  });

  it('draws workflow runs as thin bands that are never folded into a "+N", however crowded the hour is', async () => {
    const runs = Array.from({ length: 6 }, (_, i) => ({
      ...response.items[0]!, id: `workflow.run:b${i}`, runId: `b${i}`, start: at(9, i), end: at(10, 30),
      ticket: { ...ticket, id: `tk-${700 + i}`, displayId: 700 + i },
    }));
    const pts = Array.from({ length: 12 }, (_, i) => ({
      id: `ticket.created:p${i}`, type: 'ticket.created' as const, shape: 'point' as const, start: at(9, i * 2), title: `t${i}`,
    }));
    vi.mocked(api.fetchAgenda).mockResolvedValue({ ...response, items: [...runs, ...pts] });
    renderPage();
    // Six overlapping runs: six bands, none grouped, none behind a "+N".
    await waitFor(() => expect(document.querySelectorAll('[data-agenda-band]')).toHaveLength(6));
    expect(document.querySelector('[data-agenda-more]')).toBeNull();
  });

  it('hovering one day of a run that spans several days lights its band on every day', async () => {
    useAgendaStore.setState({ prefs: { ...DEFAULT_AGENDA_PREFS, view: 'week' } });
    vi.mocked(api.fetchAgendaPrefs).mockResolvedValue({ ...DEFAULT_AGENDA_PREFS, view: 'week' });
    const mon = weekStart(now);
    const d = (days: number, h: number) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + days, h).toISOString();
    // Mon 22:00 → Tue 10:00: one item, two bands (one per column).
    const run = { ...response.items[0]!, id: 'workflow.run:long', runId: 'long', start: d(0, 22), end: d(1, 10) };
    vi.mocked(api.fetchAgenda).mockResolvedValue({ ...response, items: [run] });
    renderPage();
    await waitFor(() => expect(document.querySelectorAll('[data-agenda-item="workflow.run:long"]')).toHaveLength(2));
    const [monday, tuesday] = [...document.querySelectorAll('[data-agenda-item="workflow.run:long"]')];
    fireEvent.mouseEnter(tuesday!);
    expect(monday!.hasAttribute('data-agenda-hovered')).toBe(true);
    expect(tuesday!.hasAttribute('data-agenda-hovered')).toBe(true);
    fireEvent.mouseLeave(tuesday!);
    expect(monday!.hasAttribute('data-agenda-hovered')).toBe(false);
  });

  it('opens the ticket in the Tasks view from the run popover — the agenda itself never acts on the run', async () => {
    renderPage();
    const chip = await waitFor(() => {
      const el = document.querySelector('[data-agenda-item="workflow.run:r1"]');
      if (!el) throw new Error('not yet');
      return el as HTMLElement;
    });
    fireEvent.click(chip);
    expect(screen.queryByRole('button', { name: /approve|retry|run now/i })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket' }));
    expect(await screen.findByText('task view')).toBeTruthy();
  });

  it('a click beside an open popover only closes it — it must not chain into the "new event" editor', async () => {
    renderPage();
    const chip = await waitFor(() => {
      const el = document.querySelector('[data-agenda-item="workflow.run:r1"]');
      if (!el) throw new Error('not yet');
      return el as HTMLElement;
    });
    fireEvent.click(chip);
    await screen.findByRole('button', { name: 'Open ticket' });

    const col = document.querySelector('[data-agenda-col]') as HTMLElement;
    fireEvent.pointerDown(col, { button: 0, clientX: 10, clientY: 300 });
    fireEvent.pointerUp(window, { button: 0, clientX: 10, clientY: 300 });
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open ticket' })).toBeNull());
    expect(useEventEditor.getState().editor).toBeNull();

    const cell = document.querySelector('[data-agenda-day]') as HTMLElement;
    fireEvent.click(document.querySelector('[data-agenda-item="workflow.run:r1"]') as HTMLElement);
    await screen.findByRole('button', { name: 'Open ticket' });
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.click(cell);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open ticket' })).toBeNull());
    expect(useEventEditor.getState().editor).toBeNull();

    // With nothing open, the same click creates as before.
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.click(cell);
    expect(useEventEditor.getState().editor).not.toBeNull();
  });

  it('hides a routine the user unchecked, without refetching', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('[data-agenda-item="routine.run:s1"]')).toBeTruthy());
    const calls = vi.mocked(api.fetchAgenda).mock.calls.length;
    act(() => useAgendaStore.getState().updatePrefs((p) => ({ ...p, routines: { sync: false } })));
    await waitFor(() => expect(document.querySelector('[data-agenda-item="routine.run:s1"]')).toBeNull());
    expect(vi.mocked(api.fetchAgenda).mock.calls.length).toBe(calls);
  });

  it('opens the event editor from the Create button and from the c key', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Create/ }));
    expect(await screen.findByRole('form', { name: 'New event' })).toBeTruthy();
    act(() => useEventEditor.getState().close());
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New event' })).toBeNull());
    fireEvent.keyDown(window, { key: 'c' });
    expect(await screen.findByRole('form', { name: 'New event' })).toBeTruthy();
  });

  it('toggles the "To schedule" drawer and remembers it in the prefs', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: /To schedule/ });
    expect(screen.getByRole('complementary', { name: 'To schedule' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(useAgendaStore.getState().prefs.drawerOpen).toBe(false);
    expect(screen.queryByRole('complementary', { name: 'To schedule' })).toBeNull();
  });

  it('drags a due date to another day: optimistic move, then updateTicket at noon UTC', async () => {
    const monday = weekStart(now);
    const from = dayKey(now);
    const to = dayKey(addDays(monday, now.getDay() === 1 ? 2 : 0));
    const due = {
      id: 'ticket.due:tk-765', type: 'ticket.due' as const, shape: 'allDay' as const, start: from, title: ticket.title, ticket,
    };
    vi.mocked(api.fetchAgenda).mockResolvedValue({ ...response, items: [due] });
    vi.mocked(api.updateTicket).mockResolvedValue({} as never);
    useAgendaStore.setState({ prefs: { ...DEFAULT_AGENDA_PREFS, view: 'week' } });
    vi.mocked(api.fetchAgendaPrefs).mockResolvedValue({ ...DEFAULT_AGENDA_PREFS, view: 'week' });
    renderPage();
    const chip = await waitFor(() => {
      const el = document.querySelector('[data-agenda-draggable="ticket.due:tk-765"]');
      if (!el) throw new Error('not yet');
      return el as HTMLElement;
    });
    const cell = document.querySelector(`[data-agenda-day="${to}"]`) as HTMLElement;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => cell;
    try {
      fireEvent.pointerDown(chip, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 80, clientY: 12 });
      fireEvent.pointerUp(window, { clientX: 80, clientY: 12 });
    } finally {
      document.elementFromPoint = orig;
    }
    await waitFor(() => expect(cell.querySelector('[data-agenda-item="ticket.due:tk-765"]')).toBeTruthy());
    expect(api.updateTicket).toHaveBeenCalledWith('tk-765', { dueDate: `${to}T12:00:00.000Z` });
  });
});
