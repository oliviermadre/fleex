import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Ticket, TicketGroup, BoardWithCounts } from '@fleex/shared';
import { EpicDetailView } from './EpicDetailView';
import { RouterSync } from '../../router/RouterSync';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkStore } from '../../stores/workStore';

/**
 * Regression guard for the reported bug: clicking a ticket inside an epic must
 * open THAT ticket, not redirect to the roadmap. A ticket now opens in the Work
 * view (the ticket-detail screen is retired), pinned so the Work queue filters
 * can't hide it; the epic stays the Kanban's screen, for Back.
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

  it('opens the ticket in the Work view (not the roadmap), pinned, whatever its board', async () => {
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
    useWorkStore.setState({ boardFilters: ['b1'], pinnedTicketId: null, selectedTicketId: null });

    renderEpicOpenedFromRoadmap('/tickets/board/b1/epic/e1/tickets');
    await flushRouterSync();

    await act(async () => {
      fireEvent.click(screen.getByText('Ticket Beta'));
    });
    await flushRouterSync();

    expect(currentLocation).toBe('/work/t2');
    expect(useUIStore.getState().activePanel).toBe('work');
    expect(useWorkStore.getState().selectedTicketId).toBe('t2');
    expect(useWorkStore.getState().pinnedTicketId).toBe('t2');
    // The Work filters are the user's: never widened to show the ticket.
    expect(useWorkStore.getState().boardFilters).toEqual(['b1']);
  });
});
