import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DEFAULT_AGENDA_PREFS } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgenda: vi.fn(),
  saveAgendaPrefs: vi.fn(),
  saveSavedViews: vi.fn(async (_scope: string, views: unknown) => views),
}));

import * as api from '../../services/api';
import { AgendaSavedViews } from './AgendaSavedViews';
import { useAgendaStore, type AgendaSavedView } from '../../stores/agendaStore';

const view = (id: string, name: string, over: Partial<AgendaSavedView> = {}): AgendaSavedView => ({
  id, name, emoji: null, createdAt: '', updatedAt: '',
  filters: { labels: { 'pr.merged': false }, routines: {}, filters: { boards: [], epics: ['e1'], repos: [], tags: [] }, showWorkingLocation: false },
  display: { view: 'week' },
  ...over,
});

beforeEach(() => {
  vi.mocked(api.fetchAgenda).mockResolvedValue({ from: '', to: '', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} });
  useAgendaStore.setState({ prefs: DEFAULT_AGENDA_PREFS, prefsFromServer: false, savedViews: [view('v1', 'Agenda epic'), view('v2', 'Everything')], activeViewId: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<AgendaSavedViews/>', () => {
  it('is hidden when saved views are unavailable on this storage', () => {
    useAgendaStore.setState({ savedViews: null });
    render(<AgendaSavedViews />);
    expect(screen.queryByTestId('agenda-saved-views')).toBeNull();
  });

  it('applies a view on click and highlights it', () => {
    render(<AgendaSavedViews />);
    fireEvent.click(screen.getByRole('button', { name: 'Agenda epic' }));
    const s = useAgendaStore.getState();
    expect(s.activeViewId).toBe('v1');
    expect(s.prefs.filters.epics).toEqual(['e1']);
    expect(s.prefs.labels).toEqual({ 'pr.merged': false });
    expect(screen.getByRole('button', { name: 'Agenda epic' }).getAttribute('aria-current')).toBe('true');
  });

  it('saves the current filters under a name', async () => {
    useAgendaStore.setState({ prefs: { ...DEFAULT_AGENDA_PREFS, filters: { ...DEFAULT_AGENDA_PREFS.filters, repos: ['acme/web'] } } });
    render(<AgendaSavedViews />);
    fireEvent.click(screen.getByRole('button', { name: 'Save current view' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Routines only'), { target: { value: 'Web only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveSavedViews).toHaveBeenCalled());
    const [scope, views] = vi.mocked(api.saveSavedViews).mock.calls[0]!;
    expect(scope).toBe('agenda');
    const saved = (views as AgendaSavedView[]).find((v) => v.name === 'Web only')!;
    expect(saved.filters.filters.repos).toEqual(['acme/web']);
    await waitFor(() => expect(useAgendaStore.getState().activeViewId).toBe(saved.id));
  });

  it('deletes a view after confirmation', async () => {
    render(<AgendaSavedViews />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Everything' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.saveSavedViews).toHaveBeenCalledWith('agenda', [expect.objectContaining({ id: 'v1' })]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Everything' })).toBeNull());
  });

  it('renames a view from its menu, pre-filled with the current name', async () => {
    render(<AgendaSavedViews />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Everything' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByDisplayValue('Everything');
    fireEvent.change(input, { target: { value: 'All of it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(api.saveSavedViews).toHaveBeenCalledWith('agenda', [
      expect.objectContaining({ id: 'v1', name: 'Agenda epic' }),
      expect.objectContaining({ id: 'v2', name: 'All of it' }),
    ]));
  });

  it('updates a view with the current filters', async () => {
    useAgendaStore.setState({ prefs: { ...DEFAULT_AGENDA_PREFS, view: 'month' } });
    render(<AgendaSavedViews />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Agenda epic' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Update with current filters' }));
    await waitFor(() => expect(api.saveSavedViews).toHaveBeenCalled());
    const views = vi.mocked(api.saveSavedViews).mock.calls[0]![1] as AgendaSavedView[];
    expect(views[0]).toMatchObject({ id: 'v1', display: { view: 'month' }, filters: { filters: DEFAULT_AGENDA_PREFS.filters } });
  });
});
