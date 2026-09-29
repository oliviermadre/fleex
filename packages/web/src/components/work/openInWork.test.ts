import { describe, it, expect, beforeEach } from 'vitest';
import type { SessionGroup } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkStore } from '../../stores/workStore';
import { openSessionInWork, openTicketInWork, ticketIdForSession } from './openInWork';

const session = (id: string) => ({ id }) as never;

// A repo worktree bound to ticket T1, an agent worktree bound to T2, and the
// ungrouped system shells (no ticket).
const GROUPS = [
  {
    repositoryOrg: 'org',
    repositoryName: 'app',
    worktrees: [
      { branch: 'feat/x', ticketId: 'T1', sessions: [session('s1')] },
      { branch: 'feat/y', agentWorktree: { ticketId: 'T2' }, sessions: [session('s2')] },
    ],
  },
  {
    repositoryOrg: '_ungrouped',
    repositoryName: '_ungrouped',
    worktrees: [{ branch: '_default', sessions: [session('sys')] }],
  },
] as unknown as SessionGroup[];

describe('openSessionInWork', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({ sessionGroups: GROUPS });
    useUIStore.setState({ activePanel: 'focus', floatingSessionIds: ['s1', 'sys'], floatingPanelOrder: ['s1', 'sys'] });
    useWorkStore.setState({ selectedTicketId: null, modeByTicket: {}, shellPaneIdsByTicket: {}, shellLayoutByTicket: {} });
  });

  it("resolves a session's ticket from its worktree, agent worktrees included", () => {
    expect(ticketIdForSession(GROUPS, 's1')).toBe('T1');
    expect(ticketIdForSession(GROUPS, 's2')).toBe('T2');
    expect(ticketIdForSession(GROUPS, 'sys')).toBeNull();
    expect(ticketIdForSession(GROUPS, 'unknown')).toBeNull();
  });

  it("opens the session's ticket in the Work view, shell mode, session in a pane", () => {
    expect(openSessionInWork('s1')).toBe(true);
    expect(useUIStore.getState().activePanel).toBe('work');
    const work = useWorkStore.getState();
    expect(work.selectedTicketId).toBe('T1');
    expect(work.shellMode).toBe(true);
    expect(work.shellPaneIdsByTicket.T1).toEqual(['s1']);
  });

  it('closes the floating copy, so tmux is not attached twice', () => {
    openSessionInWork('s1');
    expect(useUIStore.getState().floatingSessionIds).toEqual(['sys']);
  });

  it('does nothing for a session without a ticket (the caller decides)', () => {
    expect(openSessionInWork('sys')).toBe(false);
    expect(useUIStore.getState().activePanel).toBe('focus');
    expect(useUIStore.getState().floatingSessionIds).toEqual(['s1', 'sys']);
    expect(useWorkStore.getState().selectedTicketId).toBeNull();
  });
});

describe('openTicketInWork', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ activePanel: 'focus' });
    useWorkStore.setState({ selectedTicketId: null, modeByTicket: { T1: 'code' } });
  });

  it('reopens the ticket on the center mode it was left in', () => {
    openTicketInWork('T1');
    expect(useUIStore.getState().activePanel).toBe('work');
    expect(useWorkStore.getState().selectedTicketId).toBe('T1');
    expect(useWorkStore.getState().codeMode).toBe(true);
  });
});
