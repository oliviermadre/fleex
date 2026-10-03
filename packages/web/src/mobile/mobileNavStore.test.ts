import { describe, it, expect, beforeEach } from 'vitest';
import { useTicketStore } from '../stores/ticketStore';
import { restoreMobileNav, saveMobileNav, useMobileNavStore } from './mobileNavStore';

const fresh = () => {
  useMobileNavStore.setState({ view: 'focus', morePage: null, detailTab: 'conversation', requestedDetailTab: null });
  useTicketStore.setState({ selectedTicketId: null });
};

beforeEach(() => {
  localStorage.clear();
  fresh();
});

describe('mobile navigation across a reload', () => {
  it('reopens the same tab, ticket and ticket tab after a reload (sleep/wake)', () => {
    useMobileNavStore.setState({ view: 'tasks', detailTab: 'runs' });
    useTicketStore.setState({ selectedTicketId: 't42' });
    saveMobileNav(1_000);

    fresh(); // what a page reload does to in-memory state
    expect(restoreMobileNav(1_000 + 60_000)).toBe(true);

    expect(useMobileNavStore.getState().view).toBe('tasks');
    expect(useTicketStore.getState().selectedTicketId).toBe('t42');
    expect(useMobileNavStore.getState().requestedDetailTab).toBe('runs');
  });

  it('starts fresh on Focus when the saved state is old', () => {
    useMobileNavStore.setState({ view: 'board' });
    saveMobileNav(0);
    fresh();
    expect(restoreMobileNav(7 * 3600_000)).toBe(false);
    expect(useMobileNavStore.getState().view).toBe('focus');
  });
});
