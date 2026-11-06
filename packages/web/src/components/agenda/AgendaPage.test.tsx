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
    // The colour stripe is there from the first render, not only after a colour change.
    for (const band of document.querySelectorAll<HTMLElement>('[data-agenda-band]')) {
      expect(band.style.borderLeft).toMatch(/^3px solid /);
      expect(band.style.borderLeftWidth).not.toBe('1px');
    }
  });

  it('a band shows a status dot only while it runs (pulsing) or when it failed, and its label sits above the wait hatches', async () => {
    const base = response.items[0]!;
    const items = (['completed', 'cancelled', 'running', 'failed'] as const).map((status, i) => ({
      ...base, id: `workflow.run:${status}`, runId: status, status, start: at(9 + i, 0), end: at(9 + i, 50),
      segments: [{ kind: 'gate' as const, stepName: 'Check', start: at(9 + i, 10), end: at(9 + i, 40) }],
    }));
    vi.mocked(api.fetchAgenda).mockResolvedValue({ ...response, items });
    renderPage();
    await waitFor(() => expect(document.querySelectorAll('[data-agenda-band]')).toHaveLength(4));
    const dot = (status: string) => document.querySelector(`[data-agenda-band][data-agenda-item="workflow.run:${status}"] .rounded-full`);
    expect(dot('completed')).toBeNull();
    expect(dot('cancelled')).toBeNull();
    expect(dot('running')!.className).toContain('animate-pulse');
    expect(dot('failed')!.getAttribute('style')).toContain('--tint-red-solid');
    const label = document.querySelector('[data-agenda-item="workflow.run:completed"] [data-agenda-band-label]') as HTMLElement;
    expect(label.style.background).toContain('linear-gradient');
  });

  it('draws back-and-forth agent runs on one ticket as one session band labelled ×N, each run marked,, opening the list of runs', async () => {
    const run = (id: string, h: number, m: number) => ({
      id: `agent.run:${id}`, type: 'agent.run' as const, shape: 'block' as const, start: at(h, m), end: at(h, m + 3), status: 'completed',
      title: ticket.title, ticket, agent: { personaName: 'builder', model: 'opus', executionId: id, personaId: 'p', costUsd: 0 },
    });
    vi.mocked(api.fetchAgenda).mockResolvedValue({ ...response, items: [run('a', 9, 0), run('b', 9, 8), run('c', 9, 20), run('d', 11, 0)] });
    renderPage();
    await waitFor(() => expect(document.querySelectorAll('[data-agenda-band]')).toHaveLength(2));
    const session = document.querySelector('[data-agenda-session="3"]') as HTMLElement;
    // Labelled by its run count alone; the ticket stays in the tooltip.
    expect(session.querySelector('[data-agenda-band-label]')!.textContent).toBe('\u00d73');
    expect(session.getAttribute('title')).toContain('#765');
    expect(session.querySelectorAll('[data-agenda-session-run]')).toHaveLength(3);
    fireEvent.click(session);
    await waitFor(() => expect(document.querySelectorAll('[data-agenda-item^="agent.run:"]').length).toBeGreaterThanOrEqual(4));
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

  it('items behave like the Timeline annotations: hover previews the card, a click pins it, a second click / Escape hides it', async () => {
    renderPage();
    const chip = () => document.querySelector('[data-agenda-item="workflow.run:r1"]') as HTMLElement;
    await waitFor(() => { if (!chip()) throw new Error('not yet'); });
    const card = () => screen.queryByRole('button', { name: 'Open ticket' });
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Hover shows it, leaving hides it on its own.
    fireEvent.mouseEnter(chip());
    await screen.findByRole('button', { name: 'Open ticket' });
    fireEvent.mouseLeave(chip());
    await waitFor(() => expect(card()).toBeNull());

    // The cursor can travel into the card without it closing.
    fireEvent.mouseEnter(chip());
    await screen.findByRole('button', { name: 'Open ticket' });
    fireEvent.mouseLeave(chip());
    fireEvent.mouseEnter(screen.getByRole('dialog'));
    await wait(300);
    expect(card()).not.toBeNull();
    fireEvent.mouseLeave(screen.getByRole('dialog'));
    await waitFor(() => expect(card()).toBeNull());

    // A click pins it: leaving no longer hides it…
    fireEvent.mouseEnter(chip());
    fireEvent.click(chip());
    fireEvent.mouseLeave(chip());
    await wait(300);
    expect(card()).not.toBeNull();
    // …a second click on the item does.
    fireEvent.click(chip());
    await waitFor(() => expect(card()).toBeNull());

    // Escape hides a pinned card too.
    fireEvent.click(chip());
    await screen.findByRole('button', { name: 'Open ticket' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(card()).toBeNull());
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

describe('<AgendaPage/> search', () => {
  it('highlights the hits and really fades the others (the inline chip style used to force opacity back to 1)', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('[data-agenda-item="routine.run:s1"]')).toBeTruthy());
    act(() => { useAgendaStore.getState().setQuery('Sync'); });
    const hit = document.querySelector('[data-agenda-item="routine.run:s1"]') as HTMLElement;
    const miss = document.querySelector('[data-agenda-band="workflow.run:r1"], [data-agenda-item="workflow.run:r1"]') as HTMLElement;
    await waitFor(() => expect(hit.getAttribute('data-agenda-match')).toBe('hit'));
    expect(hit.style.boxShadow).toContain('var(--tint-yellow-solid)');
    expect(miss.getAttribute('data-agenda-match')).toBe('dim');
    expect(Number(miss.style.opacity)).toBeLessThan(0.5);

    act(() => { useAgendaStore.getState().setQuery(''); });
    await waitFor(() => expect(hit.getAttribute('data-agenda-match')).toBeNull());
    expect(hit.style.opacity).toBe('1');
  });
});
