import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GitHubIssue, PullRequest } from '@fleex/shared';
import { GetImportBrowseUseCase } from '../../src/application/use-cases/get-import-browse.js';
import { RepositoryCache } from '../../src/domain/services/repository-cache.js';
import type { RepoBatchResult } from '../../src/infrastructure/adapters/github-graphql.adapter.js';

const makeLogger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const pr = (number: number, over: Partial<PullRequest> = {}): PullRequest => ({
  number,
  title: `PR ${number}`,
  headRefName: `feat/${number}`,
  state: 'open',
  author: 'someone',
  assignees: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  ...over,
});

const issue = (number: number, over: Partial<GitHubIssue> = {}): GitHubIssue => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  author: 'someone',
  assignees: [],
  labels: [],
  commentsCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  ...over,
});

const batch = (pulls: PullRequest[], issues: GitHubIssue[] = []): RepoBatchResult => ({
  pulls,
  issues,
  closedIssues: [],
  mergedPRs: [],
  openPRsCount: pulls.length,
  openIssuesCount: issues.length,
});

interface TicketStub {
  id: string;
  displayId: number;
  links: { type: string; ref: string }[];
}

function setup(opts: {
  repos?: { org: string; name: string }[];
  batches?: Record<string, RepoBatchResult>;
  searchStdout?: string | Error;
  tickets?: TicketStub[];
} = {}) {
  const repos = opts.repos ?? [{ org: 'Acme', name: 'Api' }];
  const cache = new RepositoryCache();
  const fetchRepoBatch = vi.fn(async (wanted: { org: string; name: string }[]) => {
    const out = new Map<string, RepoBatchResult>();
    for (const r of wanted) {
      const key = `${r.org}/${r.name}`;
      out.set(key, opts.batches?.[key] ?? batch([]));
    }
    return out;
  });
  const execFn = vi.fn(async () => {
    if (opts.searchStdout instanceof Error) throw opts.searchStdout;
    return { stdout: opts.searchStdout ?? '[]', stderr: '', exitCode: 0 };
  });
  const useCase = new GetImportBrowseUseCase({
    graphql: { getCurrentUser: vi.fn(async () => 'me'), fetchRepoBatch },
    cache,
    execFn,
    ticketStore: { getAllTickets: vi.fn(async () => opts.tickets ?? []) },
    getRepos: () => repos,
    logger: makeLogger(),
  });
  return { useCase, cache, fetchRepoBatch, execFn };
}

/** Let fire-and-forget revalidations settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('GetImportBrowseUseCase — inbox', () => {
  it('sorts open PRs into "to review" and "mine", and ignores the rest', async () => {
    const { useCase } = setup({
      batches: {
        'Acme/Api': batch([
          pr(1, { author: 'me' }),
          pr(2, { reviewRequests: ['me'] }),
          pr(3, { assignees: ['me'] }),
          pr(4, { author: 'me', reviewRequests: ['me'] }), // my own PR is never "to review"
          pr(5),
        ]),
      },
    });

    const inbox = await useCase.inbox();

    expect(inbox.myPullRequests.map((p) => p.number)).toEqual([1, 4]);
    expect(inbox.reviewRequests.map((p) => p.number)).toEqual([2, 3]);
    expect(inbox.githubUser).toBe('me');
  });

  it('answers from the cache without touching GitHub once the repos are known', async () => {
    // This is the whole point: opening a picker must not cost a GitHub round-trip.
    const { useCase, fetchRepoBatch, execFn } = setup({
      batches: { 'Acme/Api': batch([pr(1, { author: 'me' })]) },
    });
    await useCase.inbox();
    expect(fetchRepoBatch).toHaveBeenCalledTimes(1);
    expect(execFn).toHaveBeenCalledTimes(2); // authored + assigned issue search

    const again = await useCase.inbox();

    expect(again.myPullRequests).toHaveLength(1);
    expect(again.stale).toBe(false);
    expect(fetchRepoBatch).toHaveBeenCalledTimes(1);
    expect(execFn).toHaveBeenCalledTimes(2);
  });

  it('only fetches the repos the cache is missing', async () => {
    const { useCase, cache, fetchRepoBatch } = setup({
      repos: [{ org: 'Acme', name: 'Api' }, { org: 'Acme', name: 'Web' }],
    });
    cache.set('pulls:Acme/Api', [pr(9, { author: 'me' })], RepositoryCache.TTL_PULLS);
    cache.set('issues:Acme/Api', [], RepositoryCache.TTL_ISSUES);

    const inbox = await useCase.inbox();

    expect(fetchRepoBatch).toHaveBeenCalledTimes(1);
    expect(fetchRepoBatch).toHaveBeenCalledWith([{ org: 'Acme', name: 'Web' }]);
    expect(inbox.myPullRequests.map((p) => p.number)).toEqual([9]);
  });

  describe('when the cached data is past its TTL', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(() => vi.useRealTimers());

    it('serves it at once, flags it stale, and refreshes behind the answer — once', async () => {
      // The scheduler is off by default, so entries DO age out. A picker must
      // still open instantly: old rows now beat a spinner, fresh rows follow.
      const { useCase, fetchRepoBatch } = setup({
        batches: { 'Acme/Api': batch([pr(1, { author: 'me' })]) },
      });
      await useCase.inbox();
      vi.setSystemTime(Date.now() + 60 * 60 * 1000); // an hour later: expired, not just stale

      const [a, b] = await Promise.all([useCase.inbox(), useCase.inbox()]);

      expect(a.stale).toBe(true);
      expect(a.myPullRequests).toHaveLength(1); // served from the old entry, not awaited
      expect(b.stale).toBe(true);
      await flush();
      // 1 cold fetch + exactly 1 revalidation, even with two concurrent callers.
      expect(fetchRepoBatch).toHaveBeenCalledTimes(2);

      const fresh = await useCase.inbox();
      expect(fresh.stale).toBe(false);
    });

    it('does not wait for GitHub to answer: a hung refresh cannot hold the picker', async () => {
      const { useCase, fetchRepoBatch } = setup({
        batches: { 'Acme/Api': batch([pr(1, { author: 'me' })]) },
      });
      await useCase.inbox();
      vi.setSystemTime(Date.now() + 60 * 60 * 1000);
      fetchRepoBatch.mockImplementationOnce(() => new Promise(() => {})); // GitHub never answers

      const answered = await Promise.race([
        useCase.inbox().then(() => 'answered'),
        new Promise((r) => setTimeout(() => r('blocked'), 50)),
      ]);

      expect(answered).toBe('answered');
    });
  });

  it('marks a row already imported as a ticket, whatever the casing of the stored PR ref', async () => {
    // PR refs are lowercased by the registry but older links kept GitHub's casing.
    const { useCase } = setup({
      batches: {
        'Acme/Api': batch(
          [pr(7, { reviewRequests: ['me'] }), pr(8, { reviewRequests: ['me'], headRefName: 'feat/wt' })],
          [issue(3, { assignees: ['me'] })],
        ),
      },
      tickets: [
        { id: 't-pr', displayId: 41, links: [{ type: 'github_pr', ref: 'acme/api#7' }] },
        { id: 't-wt', displayId: 42, links: [{ type: 'worktree', ref: 'Acme/Api:feat/wt' }] },
        { id: 't-is', displayId: 43, links: [{ type: 'github_issue', ref: 'Acme/Api#3' }] },
      ],
    });

    const inbox = await useCase.inbox();

    expect(inbox.reviewRequests[0]!.linkedTicket).toEqual({ id: 't-pr', displayId: 41 });
    expect(inbox.reviewRequests[1]!.linkedTicket).toEqual({ id: 't-wt', displayId: 42 });
    expect(inbox.issues[0]!.linkedTicket).toEqual({ id: 't-is', displayId: 43 });
  });

  it('merges the issue search with the cached repo issues, without duplicates', async () => {
    // The repo cache only holds the 50 most recently updated issues per repo; the
    // search reaches the older ones assigned to me. Both must show up, once.
    const search = JSON.stringify([
      { number: 3, title: 'Issue 3', author: { login: 'someone' }, assignees: [{ login: 'me' }], repository: { nameWithOwner: 'acme/api' }, updatedAt: '2026-09-10T00:00:00.000Z' },
      { number: 900, title: 'Old one', author: { login: 'me' }, assignees: [], repository: { nameWithOwner: 'acme/api' }, updatedAt: '2025-01-01T00:00:00.000Z' },
      { number: 1, title: 'Elsewhere', author: { login: 'me' }, assignees: [], repository: { nameWithOwner: 'other/repo' }, updatedAt: '2026-09-10T00:00:00.000Z' },
    ]);
    const { useCase } = setup({
      batches: { 'Acme/Api': batch([], [issue(3, { assignees: ['me'] }), issue(4)]) },
      searchStdout: search,
    });

    const inbox = await useCase.inbox();

    expect(inbox.issues.map((i) => i.number)).toEqual([3, 900]);
    expect(inbox.issues.every((i) => i.org === 'Acme' && i.name === 'Api')).toBe(true); // Fleex casing
  });

  it('still lists my cached issues when the GitHub search fails', async () => {
    const { useCase } = setup({
      batches: { 'Acme/Api': batch([], [issue(3, { author: 'me' })]) },
      searchStdout: new Error('gh: timed out'),
    });

    const inbox = await useCase.inbox();

    expect(inbox.issues.map((i) => i.number)).toEqual([3]);
  });

  it('flags bot pull requests so the client can hide them', async () => {
    const { useCase } = setup({
      batches: {
        'Acme/Api': batch([
          pr(1, { author: 'dependabot', headRefName: 'dependabot/npm/x', reviewRequests: ['me'] }),
          pr(2, { author: 'renovate[bot]', reviewRequests: ['me'] }),
          pr(3, { author: 'robotnik', reviewRequests: ['me'] }), // a human with "bot" in the name
        ]),
      },
    });

    const inbox = await useCase.inbox();

    expect(inbox.reviewRequests.map((p) => p.isBot)).toEqual([true, true, false]);
  });

  it('returns an empty inbox, not an error, when no repo is configured', async () => {
    const { useCase, fetchRepoBatch, execFn } = setup({ repos: [] });

    const inbox = await useCase.inbox();

    expect(inbox).toMatchObject({ issues: [], reviewRequests: [], myPullRequests: [], stale: false });
    expect(fetchRepoBatch).not.toHaveBeenCalled();
    expect(execFn).not.toHaveBeenCalled();
  });
});

describe('GetImportBrowseUseCase — one repo', () => {
  it('lists the open PRs and issues of the repo from the same cache as the inbox', async () => {
    const { useCase, fetchRepoBatch } = setup({
      batches: { 'Acme/Api': batch([pr(1), pr(2, { isDraft: true })], [issue(5)]) },
    });
    await useCase.inbox();

    const repo = await useCase.repo('acme', 'api'); // casing from a URL must still hit

    expect(repo.pullRequests.map((p) => [p.number, p.isDraft])).toEqual([[1, false], [2, true]]);
    expect(repo.issues.map((i) => i.number)).toEqual([5]);
    expect(repo.pullRequests[0]).toMatchObject({ org: 'Acme', name: 'Api' });
    expect(fetchRepoBatch).toHaveBeenCalledTimes(1); // the inbox already paid for it
  });

  it('refuses a repo that is not configured in Fleex', async () => {
    const { useCase, fetchRepoBatch } = setup();

    await expect(useCase.repo('evil', 'repo')).rejects.toThrow(/Repository not found/);
    expect(fetchRepoBatch).not.toHaveBeenCalled();
  });
});
