import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DEFAULT_AGENDA_PREFS, type AgendaGoogleStatus } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgenda: vi.fn(),
  saveAgendaPrefs: vi.fn(),
  fetchAgendaGoogleStatus: vi.fn(),
  disconnectAgendaGoogle: vi.fn(),
  agendaGoogleConnectUrl: vi.fn(() => '/auth/google-calendar?return_to=x'),
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as api from '../../services/api';
import { toast } from '../../lib/toast';
import { AgendaGoogleSection } from './AgendaGoogleSection';
import { useAgendaStore } from '../../stores/agendaStore';

const connected: AgendaGoogleStatus = {
  configured: true, connected: true, email: 'olivier@example.com',
  calendars: [{ id: 'primary@x', name: 'Olivier', primary: true }, { id: 'team@x', name: 'Team', primary: false }],
};
const emptyAgenda = { from: '', to: '', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} };

let location = '';
function Loc() {
  const l = useLocation();
  location = `${l.pathname}${l.search}`;
  return null;
}
function renderSection(url = '/agenda') {
  return render(<MemoryRouter initialEntries={[url]}><AgendaGoogleSection /><Loc /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(api.fetchAgenda).mockResolvedValue(emptyAgenda);
  vi.mocked(api.fetchAgendaGoogleStatus).mockResolvedValue(connected);
  vi.mocked(api.disconnectAgendaGoogle).mockResolvedValue();
  useAgendaStore.setState({ prefs: DEFAULT_AGENDA_PREFS, prefsFromServer: false, google: connected, data: emptyAgenda });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<AgendaGoogleSection/>', () => {
  it('says the server is not configured', () => {
    useAgendaStore.setState({ google: { configured: false, connected: false, email: null, calendars: [] } });
    renderSection();
    expect(screen.getByText(/isn't configured on this server \(GOOGLE_CLIENT_ID \/ GOOGLE_CLIENT_SECRET\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Google Calendar' })).toBeNull();
  });

  it('offers to connect when configured but not connected', () => {
    useAgendaStore.setState({ google: { configured: true, connected: false, email: null, calendars: [] } });
    const original = window.location;
    const loc = { href: '' } as Location;
    Object.defineProperty(window, 'location', { configurable: true, value: loc });
    try {
      renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
      expect(loc.href).toBe('/auth/google-calendar?return_to=x');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('when connected: shows the account, the primary calendar ticked by default, and toggling writes the explicit list then refreshes', async () => {
    renderSection();
    expect(screen.getByText('olivier@example.com')).toBeTruthy();
    const primary = screen.getByRole('checkbox', { name: /Olivier/ });
    const team = screen.getByRole('checkbox', { name: /Team/ });
    expect(primary.getAttribute('aria-checked')).toBe('true');
    expect(team.getAttribute('aria-checked')).toBe('false');
    // The only ticked calendar can't be unticked.
    expect((primary as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(team);
    expect(useAgendaStore.getState().prefs.googleCalendars).toEqual(['primary@x', 'team@x']);
    await waitFor(() => expect(api.fetchAgenda).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), ['primary@x', 'team@x']));

    fireEvent.click(screen.getByRole('checkbox', { name: /Olivier/ }));
    expect(useAgendaStore.getState().prefs.googleCalendars).toEqual(['team@x']);
  });

  it('toggles the working-location events', () => {
    renderSection();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show working location' }));
    expect(useAgendaStore.getState().prefs.showWorkingLocation).toBe(true);
  });

  it('disconnects after confirmation', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const buttons = screen.getAllByRole('button', { name: 'Disconnect' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(api.disconnectAgendaGoogle).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Google Calendar disconnected'));
  });

  it('shows the Google error of the last load', () => {
    useAgendaStore.setState({ data: { ...emptyAgenda, errors: { external: 'Google token expired' } } });
    renderSection();
    expect(screen.getByRole('alert').textContent).toContain('Google token expired');
  });

  it('toasts the OAuth outcome from the URL, then removes the param', async () => {
    renderSection('/agenda?google=connected');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Google Calendar connected'));
    await waitFor(() => expect(location).toBe('/agenda'));
    expect(api.fetchAgendaGoogleStatus).toHaveBeenCalled();
    cleanup();
    renderSection('/agenda?google_error=access_denied&x=1');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('access_denied')));
    await waitFor(() => expect(location).toBe('/agenda?x=1'));
  });
});
