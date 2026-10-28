import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePullRequestStore } from './pullRequestStore';
import { resetToasts, useToastStore } from './toastStore';

describe('pullRequestStore.fetchPullsForRepo', () => {
  beforeEach(() => {
    resetToasts();
    usePullRequestStore.setState({ pullsByRepo: {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a failing background PR poll raises no toast and keeps the last known PRs', async () => {
    // WHY: this runs every 2 min for every repo with sessions (usePullRequestPolling).
    // A GitHub/gh outage must not pop an error toast at each tick — stale data is fine.
    const known = { 'feat/a': { number: 1, headRefName: 'feat/a' } } as never;
    usePullRequestStore.setState({ pullsByRepo: { 'o/r': known } });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => JSON.stringify({ error: 'Failed to list pull requests from GitHub' }),
    })));

    await usePullRequestStore.getState().fetchPullsForRepo('o', 'r');

    expect(useToastStore.getState().toasts).toEqual([]);
    expect(usePullRequestStore.getState().pullsByRepo['o/r']).toBe(known);
  });
});
