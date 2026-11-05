import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEFAULT_AGENDA_PREFS, type AgendaResponse } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgendaPrefs: vi.fn(),
  saveAgendaPrefs: vi.fn(),
  fetchAgenda: vi.fn(),
}));
vi.mock('../../services/websocket', () => ({ appWs: { onChannel: () => () => {} } }));

import * as api from '../../services/api';
import { AgendaPage } from './AgendaPage';
import { useAgendaStore } from '../../stores/agendaStore';

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
});
afterEach(cleanup);

describe('<AgendaPage/>', () => {
  it('leads a workflow run with its ticket number, so two "Spec Dev PR" runs can be told apart', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('#765')).toBeTruthy());
    expect(screen.getAllByText('vue agenda dans routines').length).toBeGreaterThan(0);
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

  it('hides a routine the user unchecked, without refetching', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('[data-agenda-item="routine.run:s1"]')).toBeTruthy());
    const calls = vi.mocked(api.fetchAgenda).mock.calls.length;
    act(() => useAgendaStore.getState().updatePrefs((p) => ({ ...p, routines: { sync: false } })));
    await waitFor(() => expect(document.querySelector('[data-agenda-item="routine.run:s1"]')).toBeNull());
    expect(vi.mocked(api.fetchAgenda).mock.calls.length).toBe(calls);
  });
});
