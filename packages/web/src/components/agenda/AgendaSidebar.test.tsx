import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_AGENDA_PREFS, type AgendaItem, type AgendaResponse } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgenda: vi.fn(),
  saveAgendaPrefs: vi.fn(),
  saveSavedViews: vi.fn(),
  agendaGoogleConnectUrl: vi.fn(() => '/auth/google-calendar'),
}));

import { AgendaSidebar } from './AgendaSidebar';
import { useAgendaStore } from '../../stores/agendaStore';
import { useTicketStore } from '../../stores/ticketStore';

const ticketItem = (id: string, repos: string[], epicIds: string[] = []): AgendaItem => ({
  id: `ticket.created:${id}`, type: 'ticket.created', shape: 'point', start: new Date().toISOString(), title: id,
  ticket: { id, displayId: 1, title: id, boardId: 'b1', status: 'todo', tags: [], epicIds, repos },
});

const data = (items: AgendaItem[]): AgendaResponse => ({
  from: '', to: '', generatedAt: '', items, routines: [], truncated: [],
  epics: [{ id: 'e2', name: 'Billing' }, { id: 'e1', name: 'Agenda' }], errors: {},
});

function renderSidebar() {
  return render(<MemoryRouter><AgendaSidebar /></MemoryRouter>);
}

beforeEach(() => {
  useTicketStore.setState({ boards: [] });
  useAgendaStore.setState({
    prefs: DEFAULT_AGENDA_PREFS, prefsFromServer: false, savedViews: null, google: null, activeViewId: null,
    data: data([ticketItem('t1', ['acme/web']), ticketItem('t2', ['acme/api', 'acme/web'])]),
  });
});
afterEach(cleanup);

describe('<AgendaSidebar/> · Epic and Repo filters', () => {
  it('lists the epics by name and filters on the epic id', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /All epics/ }));
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Agenda')).toBeLessThan(text.indexOf('Billing'));
    fireEvent.click(screen.getByRole('button', { name: /Billing/ }));
    expect(useAgendaStore.getState().prefs.filters.epics).toEqual(['e2']);
  });

  it('lists the distinct repos of the loaded tickets, and keeps a selected one absent from the window', () => {
    useAgendaStore.setState({ prefs: { ...DEFAULT_AGENDA_PREFS, filters: { ...DEFAULT_AGENDA_PREFS.filters, repos: ['acme/old'] } } });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /Repos · 1/ }));
    expect(screen.getAllByRole('button', { name: /acme\/web/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /acme\/old/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /acme\/api/ }));
    expect(useAgendaStore.getState().prefs.filters.repos).toEqual(['acme/old', 'acme/api']);
  });

  it('offers Reset once an epic or repo is filtered, and Reset clears them too', () => {
    renderSidebar();
    expect(screen.queryByText(/Reset labels/)).toBeNull();
    cleanup();
    useAgendaStore.setState({ prefs: { ...DEFAULT_AGENDA_PREFS, filters: { boards: [], tags: [], epics: ['e1'], repos: ['acme/web'] } } });
    renderSidebar();
    fireEvent.click(screen.getByText(/Reset labels/));
    expect(useAgendaStore.getState().prefs.filters).toEqual(DEFAULT_AGENDA_PREFS.filters);
  });

  it('says that items without the field stay visible', () => {
    renderSidebar();
    expect(screen.getByText(/Items without the field/)).toBeTruthy();
  });
});
