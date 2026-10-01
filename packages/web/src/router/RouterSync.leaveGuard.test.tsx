import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { RouterSync } from './RouterSync';
import { setLeaveGuard, useUIStore } from '../stores/uiStore';

let navigate: NavigateFunction;
let path = '';
function Probe() {
  navigate = useNavigate();
  path = useLocation().pathname;
  return null;
}

afterEach(cleanup);

describe('RouterSync leave guard', () => {
  it('Back away from an unsaved screen keeps it on screen and in the address bar until the user decides', async () => {
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: 'a' } });
    render(
      <MemoryRouter initialEntries={['/settings/actions/pinned/a']}>
        <RouterSync />
        <Probe />
      </MemoryRouter>,
    );
    let pending: (() => void) | null = null;
    const unregister = setLeaveGuard((proceed) => { pending = proceed; });

    await act(async () => navigate('/settings/general'));
    // Nothing moved: the draft is still shown and the URL names it.
    expect(useUIStore.getState().settingsTab).toBe('actions');
    expect(path).toBe('/settings/actions/pinned/a');
    expect(pending).not.toBeNull();

    // The user chose Discard (or Save) — the screen's guard is still registered
    // at that point: the approved navigation must not be asked about again.
    await act(async () => pending!());
    unregister();
    expect(useUIStore.getState().settingsTab).toBe('general');
    expect(path).toBe('/settings/general');
  });
});
