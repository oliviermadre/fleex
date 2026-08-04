import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { Repository } from '@fleex/shared';
import { CreateTaskModal } from './CreateTaskModal';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import * as api from '../../services/api';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchDashboard: vi.fn(),
}));

function repo(org: string, name: string): Repository {
  return { org, name, barePath: `/bare/${org}/${name}`, defaultBranch: 'main', remote: '', isCloned: true };
}

const board = { id: 'b1', name: 'Board', emoji: '📋' } as never;

function setRepos(repos: Repository[]) {
  act(() => { useRepositoryStore.setState({ repositories: repos }); });
}

describe('CreateTaskModal repository picker', () => {
  let fetchRepositories: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(api.fetchDashboard).mockResolvedValue({ myPullRequests: [], reviewRequests: [] } as never);
    fetchRepositories = vi.fn(async () => {});
    useRepositoryStore.setState({ repositories: [], fetchRepositories });
    useTicketStore.setState({ boards: [board], tickets: [], fetchTickets: vi.fn(async () => {}) } as never);
    useUIStore.setState({ createModalOpen: true });
  });
  afterEach(() => { cleanup(); useUIStore.setState({ createModalOpen: false }); vi.clearAllMocks(); });

  it('refetches the repository list every time it opens', async () => {
    // The list is otherwise only loaded once at app boot, so a repo added
    // afterwards never shows up here (issue #134).
    render(<CreateTaskModal />);
    await waitFor(() => expect(fetchRepositories).toHaveBeenCalledTimes(1));

    act(() => { useUIStore.setState({ createModalOpen: false }); });
    act(() => { useUIStore.setState({ createModalOpen: true }); });

    await waitFor(() => expect(fetchRepositories).toHaveBeenCalledTimes(2));
  });

  it('lists a repository that only appeared after the app booted', async () => {
    render(<CreateTaskModal />);
    await waitFor(() => expect(fetchRepositories).toHaveBeenCalled());
    setRepos([repo('acme', 'newrepo')]);
    expect(screen.getByText('newrepo')).toBeTruthy();
  });

  it('drops a selected repository once it is no longer tracked', async () => {
    // A ticket linked to an untracked repo is filtered out of the sidebar,
    // so the session would be created but invisible.
    setRepos([repo('acme', 'app'), repo('acme', 'gone')]);
    render(<CreateTaskModal />);
    fireEvent.click(screen.getByText('gone'));
    fireEvent.click(screen.getByText('app'));
    expect(screen.getByText('Repositories (2 selected)')).toBeTruthy();

    setRepos([repo('acme', 'app')]);

    await waitFor(() => expect(screen.getByText('Repositories (1 selected)')).toBeTruthy());
  });

  it('keeps the Create button disabled when the only selected repo is untracked', async () => {
    setRepos([repo('acme', 'gone')]);
    render(<CreateTaskModal />);
    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByText('gone'));
    expect((screen.getByText('Create & Start').closest('button') as HTMLButtonElement).disabled).toBe(false);

    setRepos([]);

    await waitFor(() =>
      expect((screen.getByText('Create & Start').closest('button') as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it('explains an empty repository list instead of rendering an empty box', async () => {
    render(<CreateTaskModal />);
    await waitFor(() => expect(screen.getByText(/no repositories tracked/i)).toBeTruthy());
  });

  it('shows a loading hint while the first fetch is pending', () => {
    fetchRepositories = vi.fn(() => new Promise<void>(() => {}));
    useRepositoryStore.setState({ repositories: [], fetchRepositories });
    render(<CreateTaskModal />);
    expect(screen.getByText(/loading repositories/i)).toBeTruthy();
  });
});
