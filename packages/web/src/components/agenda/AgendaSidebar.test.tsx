import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_AGENDA_PREFS, type AgendaItem, type AgendaResponse } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgenda: vi.fn(),
  saveAgendaPrefs: vi.fn(),
  saveSavedViews: vi.fn(),
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

describe('<AgendaSidebar/> · routine list in a menu', () => {
  it('keeps the per-routine checkboxes out of the sidebar, in a menu at the right of "Routines"', () => {
    useAgendaStore.setState({ data: { ...data([]), routines: [{ id: 'sync', name: 'Sync backlog', emoji: '' }, { id: 'wf', name: 'WisprFlow Puller', emoji: '' }] } });
    renderSidebar();
    expect(screen.queryByText('Sync backlog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose the routines to show' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Sync backlog/ }));
    expect(useAgendaStore.getState().prefs.routines).toEqual({ sync: false });
    expect(screen.getByText('1 hidden')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(useAgendaStore.getState().prefs.routines).toEqual({});
  });

  it('puts the Google Calendar settings in a menu at the right of its label, flagged "Set up" until gogcli works', () => {
    useAgendaStore.setState({ google: { provider: 'gogcli', installed: false, version: null, connected: false, email: null, calendars: [], error: null, setupUrl: 'https://gogcli.sh/quickstart.html' } });
    renderSidebar();
    expect(screen.queryByTestId('agenda-google')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Google Calendar settings' }));
    expect(screen.getByTestId('agenda-google')).toBeTruthy();
  });
});

describe('<AgendaSidebar/> · layout and colours', () => {
  it('puts the filters and their reset at the top, under the saved views, before the labels', () => {
    useAgendaStore.setState({ prefs: { ...DEFAULT_AGENDA_PREFS, filters: { ...DEFAULT_AGENDA_PREFS.filters, tags: ['x'] } } });
    renderSidebar();
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Filters')).toBeLessThan(text.indexOf('Labels'));
    expect(text.indexOf('Reset labels')).toBeLessThan(text.indexOf('Labels'));
  });

  it('picks a colour per label, saved in the prefs, and goes back to the default', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Colour of PRs merged' }));
    fireEvent.click(screen.getByRole('button', { name: 'teal' }));
    expect(useAgendaStore.getState().prefs.colors).toEqual({ 'pr.merged': 'teal' });
    fireEvent.click(screen.getByRole('button', { name: 'Colour of PRs merged' }));
    fireEvent.click(screen.getByRole('button', { name: 'Default colour' }));
    expect(useAgendaStore.getState().prefs.colors).toEqual({});
  });

  it('picks a colour per routine from the routine menu', () => {
    const d = useAgendaStore.getState().data!;
    useAgendaStore.setState({ data: { ...d, routines: [{ id: 'sync', name: 'Sync backlog', emoji: '' }] } });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Choose the routines to show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Colour of Sync backlog' }));
    fireEvent.click(screen.getByRole('button', { name: 'orange' }));
    expect(useAgendaStore.getState().prefs.colors).toEqual({ 'routine:sync': 'orange' });
  });
});
