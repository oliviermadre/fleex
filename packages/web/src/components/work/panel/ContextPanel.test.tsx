import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Ticket, TicketLink } from '@fleex/shared';
import { SLACK_IMPORT_PENDING_TAG } from '@fleex/shared';
import { ContextPanel } from './ContextPanel';
import { useTicketStore } from '../../../stores/ticketStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useTicketGroupStore } from '../../../stores/ticketGroupStore';
import { useAgentPersonaStore } from '../../../stores/agentPersonaStore';
import type { WorkPrLink, WorkTask } from '../types';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchPRCiSummaries: vi.fn(async () => ({})),
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


// The Assignee picker lists personas: nothing to fetch here.
useAgentPersonaStore.setState({ loaded: true });

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
  tags: [],
  assignee: null,
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

// ── REPOS ──────────────────────────────────────────────────────────────────

function repo(org: string, name: string) {
  return { org, name, barePath: `/bare/${org}/${name}.git`, defaultBranch: 'main', remote: '', isCloned: true };
}

const addLink = vi.fn(async (_id: string, _payload: { ref: string }) => {});

function renderRepos(repositories: unknown[], loaded = true) {
  useTicketStore.setState({
    tickets: [{ ...TICKET, links: [] } as unknown as Ticket],
    boards: [],
    updateTicket: vi.fn(async () => {}),
    addLink,
    removeLink: vi.fn(async () => {}),
  } as never);
  useRepositoryStore.setState({ repositories, loaded } as never);
  return render(
    <MemoryRouter>
      <ContextPanel task={{ ...TASK, prs: [] } as unknown as WorkTask} onDelete={() => {}} />
    </MemoryRouter>,
  );
}

/**
 * Attaching a repo is the only way into a worktree from here. The picker used
 * to be hidden whenever the repository list was empty — which it is while the
 * slow `GET /repositories` is in flight, and stays if that call ever fails,
 * since the store swallows the error and nothing refetches. The affordance
 * disappeared with no explanation and no way back.
 */
describe('ContextPanel — attaching repos', () => {
  beforeEach(() => addLink.mockClear());

  it('offers the picker even while the repository list is still loading', () => {
    renderRepos([], false);
    expect(screen.getByText(/loading repositories/i)).toBeTruthy();
  });

  it('says so when no repo is configured, rather than showing nothing', () => {
    renderRepos([], true);
    expect(screen.getByText(/no repository configured/i)).toBeTruthy();
  });

  it('searches repos in a multi-select, like the new-task card', async () => {
    renderRepos([repo('odys-travel', 'odys-front'), repo('odys-travel', 'agentic-dmc')]);

    fireEvent.click(screen.getByRole('button', { name: /attach repo/i }));
    const search = await screen.findByPlaceholderText(/filter repos/i);
    fireEvent.change(search, { target: { value: 'front' } });

    expect(screen.getByText('odys-travel/odys-front')).toBeTruthy();
    expect(screen.queryByText('odys-travel/agentic-dmc')).toBeNull();
  });

  it('attaches every repo picked, not just one', async () => {
    renderRepos([repo('odys-travel', 'odys-front'), repo('odys-travel', 'agentic-dmc')]);

    fireEvent.click(screen.getByRole('button', { name: /attach repo/i }));
    fireEvent.click(await screen.findByText('odys-travel/odys-front'));
    fireEvent.click(screen.getByText('odys-travel/agentic-dmc'));
    fireEvent.click(screen.getByRole('button', { name: /^attach$/i }));

    await waitFor(() => expect(addLink).toHaveBeenCalledTimes(2));
    expect(addLink.mock.calls.map((c) => c[1].ref)).toEqual([
      'odys-travel/odys-front',
      'odys-travel/agentic-dmc',
    ]);
  });
});

// Retiring the ticket-detail screen must not leave tags and the other links
// (GitHub issue, Slack message…) uneditable on desktop: they live here now.
describe('ContextPanel — tags and links', () => {
  const issue = { id: 'l9', type: 'github_issue', ref: 'acme/web#4', label: '#4', url: 'https://github.com/acme/web/issues/4', createdAt: '2026-01-01T00:00:00Z' } as TicketLink;
  const updateTicket = vi.fn(async () => {});
  const addLink = vi.fn(async () => {});
  const removeLink = vi.fn(async () => {});

  function renderWith(over: Partial<Ticket>) {
    useTicketStore.setState({ tickets: [{ ...TICKET, ...over } as Ticket], updateTicket, addLink, removeLink } as never);
    return render(
      <MemoryRouter>
        <ContextPanel task={TASK} onDelete={() => {}} />
      </MemoryRouter>,
    );
  }

  it('adds a tag, keeping the hidden Slack-import tags', () => {
    renderWith({ tags: ['ux', SLACK_IMPORT_PENDING_TAG] } as Partial<Ticket>);
    expect(screen.getByText('ux')).toBeTruthy();
    expect(screen.queryByText(SLACK_IMPORT_PENDING_TAG)).toBeNull();
    // The tag box shows its placeholder only when empty: reach its input via a chip.
    const input = screen.getByText('ux').closest('div')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'auth' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateTicket).toHaveBeenCalledWith('t1', { tags: [SLACK_IMPORT_PENDING_TAG, 'ux', 'auth'] });
  });

  it('lists the other links, removes one, and adds a GitHub issue by URL', async () => {
    renderWith({ links: [...LINKS, issue] } as Partial<Ticket>);
    expect(screen.getByText('github issue')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Remove link'));
    expect(removeLink).toHaveBeenCalledWith('t1', 'l9');

    fireEvent.change(screen.getByPlaceholderText('Paste a GitHub issue URL…'), {
      target: { value: 'https://github.com/acme/api/issues/12' },
    });
    fireEvent.submit(screen.getByPlaceholderText('Paste a GitHub issue URL…').closest('form')!);
    await waitFor(() =>
      expect(addLink).toHaveBeenCalledWith('t1', {
        type: 'github_issue',
        ref: 'acme/api#12',
        label: '#12',
        url: 'https://github.com/acme/api/issues/12',
      }),
    );
  });
});
