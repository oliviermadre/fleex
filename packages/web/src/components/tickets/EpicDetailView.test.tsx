import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Ticket, TicketGroup, BoardWithCounts } from '@fleex/shared';
import { EpicDetailView } from './EpicDetailView';
import { RouterSync } from '../../router/RouterSync';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useUIStore } from '../../stores/uiStore';

/**
 * Regression guard for the reported bug: clicking a ticket inside an epic must
 * open THAT ticket's page, not redirect to the roadmap.
 *
 * An epic is only ever opened from the roadmap, so while its detail is shown the
 * store holds `activeView === 'roadmap'`. The click handler must reset the view
 * to 'board' and select the ticket's board + the ticket, otherwise RouterSync's
 * Store→URL sync recomputes the roadmap URL (the roadmap branch of `storeToUrl`
 * wins over the ticket branch while `activeView === 'roadmap'`) and the user is
 * bounced back to the roadmap. These tests would still fail if the handler
 * reverted to a raw `navigate()` that races that sync.
 */

function makeBoard(id: string, name: string): BoardWithCounts {
  return {
    id,
    name,
    emoji: '📋',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ticketCounts: { backlog: 0, todo: 0, doing: 0, reviewing: 0, done: 0, cancelled: 0 },
  };
}

function makeTicket(id: string, boardId: string, title: string): Ticket {
  return {
    id,
    boardId,
    displayId: 1,
    title,
    description: '',
    status: 'todo',
    priority: 'none',
    type: null,
    position: 0,
    tags: [],
    links: [],
    blocked: false,
    favorite: false,
    dueDate: null,
    assignee: null,
    agentClaimedAt: null,
    githubMetadata: null,
    archivedAt: null,
    firstDoingAt: null,
    statusChangedAt: '2024-01-01T00:00:00.000Z',
    conversationMode: 'plan',
    modelOverride: null,
    effortOverride: null,
    fastMode: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeGroup(id: string, boardIds: string[]): TicketGroup {
  return {
    id,
    boardIds,
    name: 'My Epic',
    emoji: '🎯',
    color: 'blue',
    description: '',
    timeframe: 'now',
    groupStatus: 'active',
    blocked: false,
    favorite: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

let currentLocation = '';
function LocationSpy() {
  const loc = useLocation();
  currentLocation = loc.pathname + loc.search;
  return null;
}

/** Flush the setTimeout(0) that RouterSync uses to release its URL→Store guard. */
async function flushRouterSync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderEpicOpenedFromRoadmap(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RouterSync />
      <LocationSpy />
      <EpicDetailView />
    </MemoryRouter>,
  );
}

describe('EpicDetailView — clicking a ticket opens the ticket page', () => {
  beforeEach(() => {
    localStorage.clear();
    currentLocation = '';
    useUIStore.setState({ activePanel: 'tickets' });
    useTicketStore.setState({
      boards: [],
      tickets: [],
      selectedBoardId: null,
      selectedTicketId: null,
      ticketTab: 'description',
    });
    useTicketGroupStore.setState({
      groups: [],
      groupTicketIds: {},
      activeView: 'board',
      selectedEpicDetailId: null,
      epicDetailTab: 'description',
    });
  });
  afterEach(() => cleanup());

  it('navigates to the ticket URL (not the roadmap) and leaves a coherent store state', async () => {
    useTicketStore.setState({
      boards: [makeBoard('b1', 'Board One')],
      tickets: [makeTicket('t1', 'b1', 'Ticket Alpha')],
      selectedBoardId: 'b1',
      selectedTicketId: null,
    });
    useTicketGroupStore.setState({
      groups: [makeGroup('e1', ['b1'])],
      groupTicketIds: { e1: ['t1'] },
      activeView: 'roadmap',
      selectedEpicDetailId: 'e1',
      epicDetailTab: 'tickets',
    });

    renderEpicOpenedFromRoadmap('/tickets/board/b1/epic/e1/tickets');
    await flushRouterSync();

    await act(async () => {
      fireEvent.click(screen.getByText('Ticket Alpha'));
    });
    await flushRouterSync();

    // AC1 — the ticket page opens, NOT the roadmap.
    expect(currentLocation).toBe('/tickets/board/b1/ticket/t1');
    expect(currentLocation).not.toBe('/tickets/board/b1/roadmap');

    // AC3 — the store state is coherent with a ticket opened on its board.
    expect(useTicketGroupStore.getState().selectedEpicDetailId).toBeNull();
    expect(useTicketGroupStore.getState().activeView).toBe('board');
    expect(useTicketStore.getState().selectedBoardId).toBe('b1');
    expect(useTicketStore.getState().selectedTicketId).toBe('t1');
  });

  it('selects the ticket board (AC2) when the epic spans multiple boards', async () => {
    useTicketStore.setState({
      boards: [makeBoard('b1', 'Board One'), makeBoard('b2', 'Board Two')],
      tickets: [makeTicket('t1', 'b1', 'Ticket Alpha'), makeTicket('t2', 'b2', 'Ticket Beta')],
      selectedBoardId: 'b1',
      selectedTicketId: null,
    });
    useTicketGroupStore.setState({
      groups: [makeGroup('e1', ['b1', 'b2'])],
      groupTicketIds: { e1: ['t1', 't2'] },
      activeView: 'roadmap',
      selectedEpicDetailId: 'e1',
      epicDetailTab: 'tickets',
    });

    renderEpicOpenedFromRoadmap('/tickets/board/b1/epic/e1/tickets');
    await flushRouterSync();

    await act(async () => {
      fireEvent.click(screen.getByText('Ticket Beta'));
    });
    await flushRouterSync();

    expect(currentLocation).toBe('/tickets/board/b2/ticket/t2');
    expect(useTicketStore.getState().selectedBoardId).toBe('b2');
    expect(useTicketStore.getState().selectedTicketId).toBe('t2');
  });
});
