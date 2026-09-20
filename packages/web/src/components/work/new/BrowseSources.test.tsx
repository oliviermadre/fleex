import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { BrowseSources } from './BrowseSources';
import * as api from '../../../services/api';
import { useRepositoryStore } from '../../../stores/repositoryStore';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchDashboard: vi.fn(),
  fetchPullRequests: vi.fn(),
}));

const fetchDashboard = api.fetchDashboard as unknown as ReturnType<typeof vi.fn>;
const fetchPullRequests = api.fetchPullRequests as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useRepositoryStore.setState({
    repositories: [{ org: 'acme', name: 'web', barePath: '', defaultBranch: 'main', remote: '', isCloned: true }],
    fetchRepositories: async () => {},
  });
});
afterEach(cleanup);

describe('BrowseSources — dashboard sections', () => {
  it('fetches the dashboard exactly once when it fails, instead of hammering the endpoint', async () => {
    fetchDashboard.mockRejectedValue(new Error('boom'));
    render(<BrowseSources onImport={() => {}} onOpenTicket={() => {}} />);

    fireEvent.click(screen.getByText('My issues'));

    await screen.findByText('boom');
    // The failing dashboard call must NOT loop (the bug: `.finally` re-ran the
    // effect whose guard passed again). Give any stray re-runs time to fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
  });

  it('refetches once more on Retry', async () => {
    fetchDashboard.mockRejectedValue(new Error('boom'));
    render(<BrowseSources onImport={() => {}} onOpenTicket={() => {}} />);

    fireEvent.click(screen.getByText('My issues'));
    await screen.findByText('boom');

    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(2));
  });
});

describe('BrowseSources — open pull requests', () => {
  it('Retry re-runs the fetch (the same-repoKey no-op used to make it dead)', async () => {
    fetchPullRequests.mockRejectedValue(new Error('nope'));
    render(<BrowseSources onImport={() => {}} onOpenTicket={() => {}} />);

    fireEvent.click(screen.getByText('Open pull requests in…'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acme/web' } });

    await screen.findByText('nope');
    expect(fetchPullRequests).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(fetchPullRequests).toHaveBeenCalledTimes(2));
  });
});
