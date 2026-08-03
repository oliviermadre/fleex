import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Repository } from '@fleex/shared';
import { useRepositoryStore } from './repositoryStore';
import * as api from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  fetchRepositories: vi.fn(),
}));

function repo(org: string, name: string): Repository {
  return { org, name, barePath: `/bare/${org}/${name}`, defaultBranch: 'main', remote: '', isCloned: true };
}

describe('repositoryStore.fetchRepositories', () => {
  beforeEach(() => {
    useRepositoryStore.setState({ repositories: [] });
  });
  afterEach(() => { vi.clearAllMocks(); });

  it('issues a single request when called twice before the first settles', async () => {
    // The New Task modal refetches on every open; open/close/open must not
    // stampede GET /repositories (it shells out to git once per repo).
    let release: (repos: Repository[]) => void = () => {};
    vi.mocked(api.fetchRepositories).mockImplementation(
      () => new Promise<Repository[]>((resolve) => { release = resolve; }),
    );

    const first = useRepositoryStore.getState().fetchRepositories();
    const second = useRepositoryStore.getState().fetchRepositories();
    expect(api.fetchRepositories).toHaveBeenCalledTimes(1);

    release([repo('acme', 'app')]);
    await Promise.all([first, second]);

    expect(useRepositoryStore.getState().repositories).toEqual([repo('acme', 'app')]);
  });

  it('starts a fresh request once the previous one has settled', async () => {
    vi.mocked(api.fetchRepositories).mockResolvedValue([repo('acme', 'app')]);
    await useRepositoryStore.getState().fetchRepositories();
    await useRepositoryStore.getState().fetchRepositories();
    expect(api.fetchRepositories).toHaveBeenCalledTimes(2);
  });

  it('keeps the last known repositories and does not reject when the request fails', async () => {
    // The modal calls this without a catch: rejecting would blank the picker
    // and log an unhandled rejection. request() already surfaced a toast.
    useRepositoryStore.setState({ repositories: [repo('acme', 'app')] });
    vi.mocked(api.fetchRepositories).mockRejectedValue(new Error('boom'));

    await expect(useRepositoryStore.getState().fetchRepositories()).resolves.toBeUndefined();

    expect(useRepositoryStore.getState().repositories).toEqual([repo('acme', 'app')]);
  });

  it('recovers on the next call after a failure', async () => {
    vi.mocked(api.fetchRepositories).mockRejectedValueOnce(new Error('boom'));
    await useRepositoryStore.getState().fetchRepositories();

    vi.mocked(api.fetchRepositories).mockResolvedValue([repo('acme', 'lib')]);
    await useRepositoryStore.getState().fetchRepositories();

    expect(useRepositoryStore.getState().repositories).toEqual([repo('acme', 'lib')]);
  });
});
