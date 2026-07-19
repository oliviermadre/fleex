import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RepositoryDashboard } from './RepositoryDashboard';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';

const data = {
  org: 'acme', name: 'app',
  openIssues: [], recentlyClosedIssues: [], openPullRequests: [], recentlyMergedPullRequests: [],
  worktrees: [], worktreeTickets: [], diffStats: {}, githubUser: 'me', isClonedLocally: true,
};

describe('RepositoryDashboard tabs', () => {
  beforeEach(() => {
    useRepositoryDashboardStore.setState({
      dashboardData: data as never,
      repoStats: {},
      fetchDashboard: vi.fn(async () => {}),
      fetchRepoStats: vi.fn(async () => {}),
    } as never);
  });
  afterEach(cleanup);

  it('renders the four tabs with Overview as default', () => {
    render(<MemoryRouter><RepositoryDashboard repoKey="acme/app" /></MemoryRouter>);
    for (const label of ['Overview', 'Pull Requests', 'Issues', 'Config']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Tickets & worktrees')).toBeTruthy(); // Overview content visible by default
  });

  it('switches tabs', () => {
    render(<MemoryRouter><RepositoryDashboard repoKey="acme/app" /></MemoryRouter>);
    fireEvent.click(screen.getByText('Config'));
    expect(screen.getByText('Post-checkout hook')).toBeTruthy();
  });
});
