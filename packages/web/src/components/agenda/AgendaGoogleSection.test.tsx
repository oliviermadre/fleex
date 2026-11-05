import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DEFAULT_AGENDA_PREFS, type AgendaGoogleStatus } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgenda: vi.fn(),
  saveAgendaPrefs: vi.fn(),
  fetchAgendaGoogleStatus: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as api from '../../services/api';
import { toast } from '../../lib/toast';
import { AgendaGoogleSection } from './AgendaGoogleSection';
import { useAgendaStore } from '../../stores/agendaStore';

const SETUP = 'https://gogcli.sh/quickstart.html';
const base = { provider: 'gogcli' as const, setupUrl: SETUP, error: null };
const notInstalled: AgendaGoogleStatus = { ...base, installed: false, version: null, connected: false, email: null, calendars: [] };
const notAuthorized: AgendaGoogleStatus = { ...notInstalled, installed: true, version: 'v0.47.1', error: 'OAuth client credentials missing (OAuth client ID JSON).' };
const connected: AgendaGoogleStatus = {
  ...base, installed: true, version: 'v0.47.1', connected: true, email: 'olivier@example.com',
  calendars: [{ id: 'primary@x', name: 'Olivier', primary: true }, { id: 'team@x', name: 'Team', primary: false }],
};
const emptyAgenda = { from: '', to: '', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} };

function renderSection() {
  return render(<AgendaGoogleSection />);
}

beforeEach(() => {
  vi.mocked(api.fetchAgenda).mockResolvedValue(emptyAgenda);
  vi.mocked(api.fetchAgendaGoogleStatus).mockResolvedValue(connected);
  useAgendaStore.setState({ prefs: DEFAULT_AGENDA_PREFS, prefsFromServer: false, google: connected, data: emptyAgenda });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<AgendaGoogleSection/>', () => {
  it('not installed: says Google is read through gogcli, set up outside Fleex, with the install command and the setup guide', () => {
    useAgendaStore.setState({ google: notInstalled });
    renderSection();
    const section = screen.getByTestId('agenda-google');
    expect(section.textContent).toMatch(/read through gogcli/);
    expect(section.textContent).toMatch(/not in Fleex/);
    expect(screen.getByText('brew install openclaw/tap/gogcli')).toBeTruthy();
    expect(screen.getByText('gog auth credentials <client_secret.json>')).toBeTruthy();
    expect(screen.getByText(/gog auth add .* --services calendar --readonly/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Setup guide/ });
    expect(link.getAttribute('href')).toBe(SETUP);
    expect(link.getAttribute('target')).toBe('_blank');
    // No in-app OAuth any more.
    expect(screen.queryByRole('button', { name: /Connect Google Calendar/ })).toBeNull();
  });

  it('installed but not authorized: install step done, gog\'s error shown', () => {
    useAgendaStore.setState({ google: notAuthorized });
    renderSection();
    expect(screen.queryByText('brew install openclaw/tap/gogcli')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('OAuth client credentials missing');
  });

  it('Check again re-reads the status bypassing the server cache, and reloads the agenda once readable', async () => {
    useAgendaStore.setState({ google: notAuthorized });
    vi.mocked(api.fetchAgendaGoogleStatus).mockResolvedValueOnce(connected);
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(api.fetchAgendaGoogleStatus).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Google Calendar is readable through gogcli'));
    await waitFor(() => expect(api.fetchAgenda).toHaveBeenCalled());
    expect(screen.getByText('olivier@example.com')).toBeTruthy();
  });

  it('Check again while still not set up: says what is missing', async () => {
    useAgendaStore.setState({ google: notInstalled });
    vi.mocked(api.fetchAgendaGoogleStatus).mockResolvedValueOnce(notAuthorized);
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('gogcli is installed but not authorized yet'));
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

  it('lists the primary calendar first, then the others alphabetically', () => {
    useAgendaStore.setState({
      google: {
        ...connected,
        calendars: [
          { id: 'z', name: 'zeta', primary: false },
          { id: 'b', name: 'Bravo', primary: false },
          { id: 'me', name: 'Olivier', primary: true },
          { id: 'a', name: 'alpha', primary: false },
        ],
      },
    });
    renderSection();
    const names = screen.getAllByRole('checkbox').map((c) => c.textContent?.replace('primary', '').trim());
    expect(names.slice(0, 4)).toEqual(['Olivier', 'alpha', 'Bravo', 'zeta']);
  });

  it('toggles the working-location events', () => {
    renderSection();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show working location' }));
    expect(useAgendaStore.getState().prefs.showWorkingLocation).toBe(true);
  });

  it('when connected: names the gogcli dependency with its version and the setup link, no Disconnect', () => {
    renderSection();
    expect(screen.getByText(/Read through gogcli v0\.47\.1/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /setup/ }).getAttribute('href')).toBe(SETUP);
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('shows the Google error of the last load', () => {
    useAgendaStore.setState({ data: { ...emptyAgenda, errors: { external: 'Google token expired' } } });
    renderSection();
    expect(screen.getByRole('alert').textContent).toContain('Google token expired');
  });

});
