import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BoardWithCounts, Repository, Ticket, TicketGroup } from '@fleex/shared';
import { NewTask } from './NewTask';
import { useTicketStore } from '../../../stores/ticketStore';
import { useTicketGroupStore } from '../../../stores/ticketGroupStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useWorkStore } from '../../../stores/workStore';

const epicsByBoard: Record<string, TicketGroup[]> = {};

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchTicketGroups: vi.fn(async (boardId?: string) => epicsByBoard[boardId ?? ''] ?? []),
}));

const createTicket = vi.fn(async () => ({ id: 't-new' }) as Ticket);
const addLink = vi.fn(async () => {});
const addTicketToGroup = vi.fn(async () => {});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  epicsByBoard.b1 = [epic('e1', 'Checkout', 'b1'), epic('e2', 'Search', 'b1'), epic('e3', 'Shipped', 'b1', 'done')];
  epicsByBoard.b2 = [];
  useTicketStore.setState({
    boards: [board('b1', 'Alpha'), board('b2', 'Beta')],
    tickets: [ticketWithRepo('b1', 'acme/web')],
    createTicket,
    addLink,
  });
  useTicketGroupStore.setState({ groups: [], ticketGroupIds: {}, addTicketToGroup });
  useRepositoryStore.setState({ repositories: [repo('acme', 'api'), repo('acme', 'web')] });
  useWorkStore.setState({ view: 'new' });
  useWorkStore.getState().updateDraft({
    text: '',
    boardId: 'b1',
    epicIds: [],
    repoKeys: [],
    repoBaseBranches: {},
  });
});

afterEach(cleanup);

describe('NewTask — board, epics, repos', () => {
  it('shows Epics between Board and Repos when the board has active epics', async () => {
    render(<NewTask />);

    await screen.findByText('EPICS');
    const labels = screen.getAllByText(/^(BOARD|EPICS|REPOS)$/).map((el) => el.textContent);
    expect(labels).toEqual(['BOARD', 'EPICS', 'REPOS']);

    fireEvent.click(screen.getByRole('button', { name: 'No epic' }));
    expect(screen.getByText('Checkout')).toBeTruthy();
    expect(screen.queryByText('Shipped')).toBeNull();
  });

  it('hides Epics for a board without epics, and drops the epics picked on the previous board', async () => {
    useWorkStore.getState().updateDraft({ epicIds: ['e1'] });
    render(<NewTask />);
    await screen.findByText('EPICS');

    fireEvent.click(screen.getByTitle('Click to change board'));
    fireEvent.click(screen.getByText('Beta'));

    await waitFor(() => expect(screen.queryByText('EPICS')).toBeNull());
    expect(useWorkStore.getState().draft.epicIds).toEqual([]);
  });

  it("lists the board's most used repos first, under Suggested", () => {
    render(<NewTask />);

    fireEvent.click(screen.getByRole('button', { name: 'No repo' }));

    const text = document.body.textContent ?? '';
    expect(text.indexOf('Suggested')).toBeGreaterThan(-1);
    expect(text.indexOf('Suggested')).toBeLessThan(text.indexOf('acme/web'));
    expect(text.indexOf('acme/web')).toBeLessThan(text.indexOf('All repos'));
    expect(text.indexOf('All repos')).toBeLessThan(text.indexOf('acme/api'));
  });

  it('falls back to the first board when the remembered one is gone', () => {
    useWorkStore.getState().updateDraft({ boardId: 'deleted-board' });
    useTicketStore.setState({ boards: [board('b2', 'Beta'), board('b1', 'Alpha')] });
    render(<NewTask />);

    expect(screen.getByTitle('Click to change board').textContent).toContain('Beta');
  });

  it('remembers the board the task was actually created on, even when it was the fallback', async () => {
    useWorkStore.getState().updateDraft({ text: 'Write the docs', boardId: null });
    useTicketStore.setState({ boards: [board('b2', 'Beta'), board('b1', 'Alpha')] });
    render(<NewTask />);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(useWorkStore.getState().draft).toMatchObject({ text: '', boardId: 'b2' }));
  });

  it('adds the new ticket to each picked epic and keeps the board for the next task', async () => {
    useWorkStore.getState().updateDraft({ text: 'Add Apple Pay', epicIds: ['e1', 'e2'] });
    render(<NewTask />);
    await screen.findByText('EPICS');

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(addTicketToGroup).toHaveBeenCalledTimes(2));
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ boardId: 'b1', title: 'Add Apple Pay' }));
    expect(addTicketToGroup).toHaveBeenCalledWith('e1', 't-new');
    expect(addTicketToGroup).toHaveBeenCalledWith('e2', 't-new');
    await waitFor(() => expect(useWorkStore.getState().draft).toMatchObject({ text: '', epicIds: [], boardId: 'b1' }));
  });
});

function board(id: string, name: string): BoardWithCounts {
  return {
    id,
    name,
    emoji: '📋',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ticketCounts: { backlog: 0, todo: 0, doing: 0, reviewing: 0, done: 0, cancelled: 0 },
  };
}

function epic(id: string, name: string, boardId: string, groupStatus: TicketGroup['groupStatus'] = 'active'): TicketGroup {
  return {
    id,
    boardIds: [boardId],
    name,
    emoji: '🚀',
    color: 'blue',
    description: '',
    timeframe: 'now',
    groupStatus,
    blocked: false,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function repo(org: string, name: string): Repository {
  return { org, name, barePath: '', defaultBranch: 'main', remote: '', isCloned: true };
}

/** Only what the repo ranking reads: the board and its repository links. */
function ticketWithRepo(boardId: string, ref: string): Ticket {
  return {
    id: `t-${ref}`,
    boardId,
    links: [{ id: 'l1', type: 'repository', ref, label: ref, url: null, createdAt: new Date().toISOString() }],
  } as unknown as Ticket;
}
