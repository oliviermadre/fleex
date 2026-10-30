import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { RouterSync } from './RouterSync';
import { useTicketStore } from '../stores/ticketStore';
import { useTicketGroupStore } from '../stores/ticketGroupStore';
import { useUIStore } from '../stores/uiStore';
import { useWorkStore } from '../stores/workStore';

/**
 * These tests pin the *intent* of the history fix: the default detail tab
 * ('description') is omitted from the URL, so navigating Back onto the tab-less
 * epic URL must return the store to the description tab. A test that could
 * still pass while the store kept the previous tab (comments/deliverables)
 * would defeat the purpose — the "description" history entry would look like
 * "rien ne se passe" and get visually skipped, which is exactly the reported bug.
 */

// Capture the router's navigate so a test can drive Back/Forward-style URL changes.
let navigate: (to: string) => void = () => {};
function NavCapture() {
  navigate = useNavigate();
  return null;
}

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RouterSync />
      <NavCapture />
    </MemoryRouter>,
  );
}

describe('RouterSync URL→Store detail-tab sync', () => {
  beforeEach(() => {
    useTicketStore.setState({ selectedBoardId: null, selectedTicketId: null });
    useTicketGroupStore.setState({ selectedEpicDetailId: null, epicDetailTab: 'description' });
    useUIStore.setState({ activePanel: 'focus' });
  });
  afterEach(() => cleanup());

  it('restores the description tab when navigating back to the tab-less epic URL', () => {
    renderAt('/tickets/board/all/epic/e1/deliverables');
    expect(useTicketGroupStore.getState().epicDetailTab).toBe('deliverables');

    act(() => navigate('/tickets/board/all/epic/e1'));
    expect(useTicketGroupStore.getState().epicDetailTab).toBe('description');
  });
});

// The Work view's URL names what is on screen — task and center mode — so a
// reload, a copied link or Back/Forward reopen exactly that.
describe('RouterSync — Work view URLs', () => {
  let pathname = '';
  function LocationCapture() {
    pathname = useLocation().pathname;
    return null;
  }
  function renderWorkAt(initialPath: string) {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <RouterSync />
        <NavCapture />
        <LocationCapture />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ activePanel: 'focus' });
    useWorkStore.setState({ selectedTicketId: null, view: 'task', modeByTicket: {}, modeTicketId: null, pinnedTicketId: null, rightPanel: 'context', timelineOpen: false });
  });
  afterEach(() => cleanup());

  it('opens the linked task in the linked mode, pinned in the queue', () => {
    renderWorkAt('/work/t1/shell');
    const work = useWorkStore.getState();
    expect(useUIStore.getState().activePanel).toBe('work');
    expect(work.selectedTicketId).toBe('t1');
    expect(work.shellMode).toBe(true);
    expect(work.modeByTicket.t1).toBe('shell');
    expect(work.pinnedTicketId).toBe('t1');
  });

  it('opens the new-task composer from /work/new', () => {
    renderWorkAt('/work/new');
    expect(useWorkStore.getState().view).toBe('new');
  });

  it('spells bare /work out as the remembered task', () => {
    useWorkStore.setState({ selectedTicketId: 't1', modeByTicket: { t1: 'code' } });
    renderWorkAt('/work');
    expect(pathname).toBe('/work/t1/code');
  });

  it('follows the store: selecting another task and switching its mode update the URL', async () => {
    renderWorkAt('/work/t1');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => useWorkStore.getState().selectTicket('t2'));
    expect(pathname).toBe('/work/t2');
    // RouterSync ignores store changes for one tick after a URL change (its
    // loop guard); user actions are never that close together.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => {
      useWorkStore.getState().restoreTicketMode('t2');
      useWorkStore.getState().setMode('shell');
    });
    expect(pathname).toBe('/work/t2/shell');
  });

  // The ticket-detail screen is gone: its old links (bookmarks, notifications
  // already stored) must still land on the ticket, on the matching panel.
  it('redirects a legacy ticket-detail URL to the Work view, deliverables panel open', () => {
    renderWorkAt('/tickets/board/b1/ticket/t1/deliverables');
    const work = useWorkStore.getState();
    expect(pathname).toBe('/work/t1');
    expect(useUIStore.getState().activePanel).toBe('work');
    expect(work.selectedTicketId).toBe('t1');
    expect(work.pinnedTicketId).toBe('t1');
    expect(work.rightPanel).toBe('deliv');
  });

  it('redirects the legacy workflow tab to the workflow mode, activity to the Timeline', () => {
    renderWorkAt('/tickets/board/all/ticket/t1/workflow');
    expect(pathname).toBe('/work/t1/workflow');
    expect(useWorkStore.getState().workflowMode).toBe(true);
    cleanup();
    renderWorkAt('/tickets/board/all/ticket/t2/activity');
    expect(pathname).toBe('/work/t2');
    expect(useWorkStore.getState().timelineOpen).toBe(true);
  });

  // Back/Forward through rows picked in the queue must not steal the pin from
  // the ticket that brought the user here.
  it('a URL naming a ticket already in the queue selects it without re-pinning', () => {
    useTicketStore.setState({
      tickets: [{ id: 't2', boardId: 'b1', status: 'doing', priority: 'medium', favorite: false, title: 'In queue' }] as never,
    });
    useWorkStore.setState({ boardFilters: [], statusFilters: ['doing'], priorityFilters: [], favoriteOnly: false, search: '' });
    renderWorkAt('/work/t1');
    expect(useWorkStore.getState().pinnedTicketId).toBe('t1');
    act(() => navigate('/work/t2'));
    expect(useWorkStore.getState().selectedTicketId).toBe('t2');
    expect(useWorkStore.getState().pinnedTicketId).toBe('t1');
  });

  it('returns to chat when Back lands on the mode-less task URL', () => {
    renderWorkAt('/work/t1/shell');
    act(() => navigate('/work/t1'));
    expect(useWorkStore.getState().shellMode).toBe(false);
    expect(useWorkStore.getState().modeByTicket.t1).toBeUndefined();
  });
});
