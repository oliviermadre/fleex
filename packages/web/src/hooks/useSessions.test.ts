import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSessions } from './useSessions';
import { useSessionStore } from '../stores/sessionStore';
import { NetworkError } from '../services/api';
import * as api from '../services/api';

/**
 * The sidebar used to render an empty list whether there were no sessions or
 * the fetch had blown up — `.catch(() => {})` erased the difference. These
 * tests pin the distinction down: a failure must leave a trace the UI can act
 * on, and a later success must clear it.
 */

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return { ...actual, fetchSessions: vi.fn(), fetchSessionGroups: vi.fn() };
});

const fetchSessions = api.fetchSessions as unknown as ReturnType<typeof vi.fn>;
const fetchSessionGroups = api.fetchSessionGroups as unknown as ReturnType<typeof vi.fn>;

describe('loadSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ sessions: [], sessionGroups: [], sessionsLoadError: null });
  });

  it('records an unreachable server instead of swallowing it', async () => {
    fetchSessions.mockRejectedValue(new NetworkError(new TypeError('Failed to fetch')));
    fetchSessionGroups.mockRejectedValue(new NetworkError(new TypeError('Failed to fetch')));

    await loadSessions();

    expect(useSessionStore.getState().sessionsLoadError).toContain('Cannot reach the Fleex server');
  });

  it('keeps a generic message for HTTP failures — request() already toasted the detail', async () => {
    fetchSessions.mockRejectedValue(new Error('API error 500: internal stack trace'));
    fetchSessionGroups.mockResolvedValue([]);

    await loadSessions();

    expect(useSessionStore.getState().sessionsLoadError).toBe('Could not load sessions');
  });

  it('does not throw — a boot failure must not take the caller down with it', async () => {
    fetchSessions.mockRejectedValue(new Error('boom'));
    fetchSessionGroups.mockRejectedValue(new Error('boom'));

    await expect(loadSessions()).resolves.toBeUndefined();
  });

  // Without this the banner would stay up forever after a successful retry.
  it('clears a previous error once the data comes back', async () => {
    useSessionStore.setState({ sessionsLoadError: 'Could not load sessions' });
    fetchSessions.mockResolvedValue([]);
    fetchSessionGroups.mockResolvedValue([]);

    await loadSessions();

    expect(useSessionStore.getState().sessionsLoadError).toBeNull();
  });

  it('leaves no error behind on a clean load', async () => {
    fetchSessions.mockResolvedValue([]);
    fetchSessionGroups.mockResolvedValue([]);

    await loadSessions();

    expect(useSessionStore.getState().sessionsLoadError).toBeNull();
  });
});
