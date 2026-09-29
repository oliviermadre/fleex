import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Session, SessionGroup } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkStore } from '../../stores/workStore';

// The terminal itself (xterm + WS) is irrelevant to where the title bar sends you.
vi.mock('../../hooks/useTerminal', () => ({ useTerminal: () => {} }));
vi.mock('../../services/terminalManager', () => ({ terminalManager: { get: () => undefined, setFloatingMode: () => {}, resize: () => {}, attach: () => {} } }));

import { FloatingSessionOverlay } from './FloatingSessionOverlay';

const session = (id: string, tmuxName: string) =>
  ({ id, tmuxName, type: 'shell', status: 'running', cwd: '/tmp', createdAt: '2026-01-01T00:00:00Z' }) as unknown as Session;

describe('FloatingSessionOverlay — title bar double-click', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      sessions: [session('s1', 'ticket-shell'), session('sys', 'system-shell')],
      sessionGroups: [
        { repositoryOrg: 'org', repositoryName: 'app', worktrees: [{ branch: 'feat/x', ticketId: 'T1', sessions: [session('s1', 'ticket-shell')] }] },
        { repositoryOrg: '_ungrouped', repositoryName: '_ungrouped', worktrees: [{ branch: '_default', sessions: [session('sys', 'system-shell')] }] },
      ] as unknown as SessionGroup[],
    });
    useUIStore.setState({ activePanel: 'focus', floatingSessionIds: [], floatingPanelOrder: [] });
    useWorkStore.setState({ selectedTicketId: null, modeByTicket: {}, shellPaneIdsByTicket: {}, shellLayoutByTicket: {} });
  });
  afterEach(() => cleanup());

  it("maximises a ticket's session into the Work view shell and closes the overlay", () => {
    useUIStore.setState({ floatingSessionIds: ['s1'], floatingPanelOrder: ['s1'] });
    render(<FloatingSessionOverlay />);
    fireEvent.doubleClick(screen.getByText('ticket-shell'));

    expect(useUIStore.getState().activePanel).toBe('work');
    expect(useWorkStore.getState().selectedTicketId).toBe('T1');
    expect(useWorkStore.getState().shellMode).toBe(true);
    expect(useWorkStore.getState().shellPaneIdsByTicket.T1).toEqual(['s1']);
    expect(useUIStore.getState().floatingSessionIds).toEqual([]);
  });

  it('leaves a system shell (no ticket) floating where it is', () => {
    useUIStore.setState({ floatingSessionIds: ['sys'], floatingPanelOrder: ['sys'] });
    render(<FloatingSessionOverlay />);
    fireEvent.doubleClick(screen.getByText('system-shell'));

    expect(useUIStore.getState().activePanel).toBe('focus');
    expect(useUIStore.getState().floatingSessionIds).toEqual(['sys']);
    expect(screen.getByText('system-shell')).toBeTruthy();
  });
});
