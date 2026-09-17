import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Ticket, TicketLink } from '@fleex/shared';
import { ContextPanel } from './ContextPanel';
import { useTicketStore } from '../../../stores/ticketStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useTicketGroupStore } from '../../../stores/ticketGroupStore';
import type { WorkPrLink, WorkTask } from '../types';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchPRStates: vi.fn(async () => ({})),
  fetchTicketGroups: vi.fn(async () => []),
}));

function prLink(ref: string, id: string): TicketLink {
  return { id, type: 'github_pr', ref, label: `#${ref.split('#')[1]}`, url: null, createdAt: '2026-01-01T00:00:00Z' };
}

function pr(ref: string, additions: number, deletions: number): WorkPrLink {
  const [repo, number] = ref.split('#');
  return {
    ref,
    label: `${repo!.split('/')[1]}#${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    state: 'open',
    title: null,
    additions,
    deletions,
  };
}

const LINKS = [prLink('odys-travel/agentic-dmc-2#11', 'l1'), prLink('odys-travel/odys-front#2933', 'l2')];

const TICKET = {
  id: 't1',
  displayId: 1,
  title: 'A ticket with two PRs',
  boardId: 'b1',
  status: 'in_progress',
  type: null,
  priority: 'medium',
  favorite: false,
  blocked: false,
  links: LINKS,
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Ticket;

const TASK = {
  id: 't1',
  number: 1,
  title: TICKET.title,
  boardId: 'b1',
  worktrees: [],
  // The ticket-level aggregate: the summed worktree diff across BOTH repos.
  pr: { ref: 'odys-travel/agentic-dmc-2#11', checksLabel: null, additions: 5660, deletions: 60 },
  prs: [pr('odys-travel/agentic-dmc-2#11', 5600, 12), pr('odys-travel/odys-front#2933', 60, 48)],
} as unknown as WorkTask;

beforeEach(() => {
  vi.clearAllMocks();
  useTicketStore.setState({
    tickets: [TICKET],
    boards: [],
    updateTicket: vi.fn(async () => {}),
    addLink: vi.fn(async () => {}),
    removeLink: vi.fn(async () => {}),
  } as never);
  useRepositoryStore.setState({ repositories: [] } as never);
  useTicketGroupStore.setState({
    groups: [],
    ticketGroupIds: {},
    fetchTicketMemberships: vi.fn(async () => {}),
    addTicketToGroup: vi.fn(async () => {}),
    removeTicketFromGroup: vi.fn(async () => {}),
  } as never);
});

afterEach(cleanup);

/** Each PR row carries its own size — the ticket-level worktree total belongs to no single PR. */
describe('ContextPanel — pull request sizes', () => {
  function rowFor(label: string): HTMLElement {
    const badge = screen.getByText(label);
    const row = badge.closest('div.group');
    if (!row) throw new Error(`no PR row found for ${label}`);
    return row as HTMLElement;
  }

  it('shows each PR its own additions and deletions', () => {
    render(
      <MemoryRouter>
        <ContextPanel task={TASK} onDelete={() => {}} />
      </MemoryRouter>,
    );

    const dmc = rowFor('agentic-dmc-2#11');
    expect(within(dmc).getByText('+5600')).toBeTruthy();
    expect(within(dmc).getByText('-12')).toBeTruthy();

    const front = rowFor('odys-front#2933');
    expect(within(front).getByText('+60')).toBeTruthy();
    expect(within(front).getByText('-48')).toBeTruthy();
  });

  it('never repeats the summed worktree total on every row', () => {
    render(
      <MemoryRouter>
        <ContextPanel task={TASK} onDelete={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.queryAllByText('+5660')).toHaveLength(0);
  });
});
