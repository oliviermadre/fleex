import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Session, SessionGroup } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkStore } from '../../stores/workStore';
import { useTicketStore } from '../../stores/ticketStore';

vi.mock('../../services/api', () => ({ createSession: vi.fn(), fetchSessionGroups: vi.fn() }));

import { useCommandItems } from './useCommandItems';

const session = (id: string, tmuxName: string) => ({ id, tmuxName, type: 'shell' }) as unknown as Session;

describe('useCommandItems — sessions after the Sessions view', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      sessions: [session('s1', 'ticket-shell'), session('sys', 'system-shell')],
      sessionGroups: [
        { repositoryOrg: 'org', repositoryName: 'app', worktrees: [{ branch: 'feat/x', ticketId: 'T1', sessions: [session('s1', 'ticket-shell')] }] },
        { repositoryOrg: '_ungrouped', repositoryName: '_ungrouped', worktrees: [{ branch: '_default', sessions: [session('sys', 'system-shell')] }] },
      ] as unknown as SessionGroup[],
    });
    useTicketStore.setState({ tickets: [] });
    useUIStore.setState({ activePanel: 'tickets', floatingSessionIds: [], floatingPanelOrder: [] });
    useWorkStore.setState({ selectedTicketId: null, modeByTicket: {}, shellPaneIdsByTicket: {}, shellLayoutByTicket: {} });
  });

  const items = () => renderHook(() => useCommandItems('')).result.current;
  const item = (id: string) => items().find((i) => i.id === id)!;

  it("opens a ticket's session in the Work view shell", () => {
    item('session:s1').onExecute();
    expect(useUIStore.getState().activePanel).toBe('work');
    expect(useWorkStore.getState().selectedTicketId).toBe('T1');
    expect(useWorkStore.getState().shellMode).toBe(true);
  });

  it('opens a ticketless session as a floating terminal instead', () => {
    item('session:sys').onExecute();
    expect(useUIStore.getState().activePanel).toBe('tickets');
    expect(useUIStore.getState().floatingSessionIds).toEqual(['sys']);
  });

  it('no longer offers the retired Sessions view or its layout groups', () => {
    const ids = items().map((i) => i.id);
    expect(ids).not.toContain('view:sessions');
    expect(ids).not.toContain('create:group-1x2');
    expect(ids).not.toContain('create:group-2x2');
    expect(ids).toContain('view:work');
    expect(ids).toContain('create:shell');
  });
});
