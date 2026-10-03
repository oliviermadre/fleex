import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PrCiSummary } from '@fleex/shared';

const api = vi.hoisted(() => ({
  fetchPRCiSummaries: vi.fn(),
  fetchPRCiDetail: vi.fn(),
  mergePR: vi.fn(),
}));
vi.mock('../services/api', () => api);

import { usePrCiStore, resetPrCiStore, POLL_IDLE_MS, POLL_RUNNING_MS } from './prCiStore';

function summary(ref: string, patch: Partial<PrCiSummary> = {}): PrCiSummary {
  return { ref, state: 'OPEN', isDraft: false, ciStatus: 'passed', counts: { pass: 1 }, ...patch };
}

/** Answer every summary request with these per-ref summaries. */
function serve(byRef: Record<string, Partial<PrCiSummary>>) {
  api.fetchPRCiSummaries.mockImplementation(async (refs: string[]) =>
    Object.fromEntries(refs.filter((r) => byRef[r]).map((r) => [r, summary(r, byRef[r])])),
  );
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetPrCiStore();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => {
  resetPrCiStore();
  vi.useRealTimers();
});

describe('prCiStore subscriptions', () => {
  it('coalesces every chip mounting in the same tick into one request (a board of N chips = 1 call)', async () => {
    serve({ 'a/b#1': {}, 'a/b#2': {}, 'a/c#3': {} });
    const { subscribe } = usePrCiStore.getState();
    subscribe(['a/b#1']);
    subscribe(['a/b#2']);
    subscribe(['a/c#3']);
    subscribe(['a/b#1']); // same PR in two places
    await flush();

    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(1);
    expect(api.fetchPRCiSummaries.mock.calls[0]![0].sort()).toEqual(['a/b#1', 'a/b#2', 'a/c#3']);
    expect(Object.keys(usePrCiStore.getState().summaries).sort()).toEqual(['a/b#1', 'a/b#2', 'a/c#3']);
  });

  it('serves a second chip for an already-known PR from the cache, without a request', async () => {
    serve({ 'a/b#1': {} });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(1);
  });

  it('records an error per ref when the request fails, so the chip shows "CI ?"', async () => {
    api.fetchPRCiSummaries.mockRejectedValue(new Error('gh: rate limited'));
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    expect(usePrCiStore.getState().errors['a/b#1']).toBe('gh: rate limited');
  });
});

describe('prCiStore polling', () => {
  it('polls every 5 min when nothing is running', async () => {
    serve({ 'a/b#1': { ciStatus: 'passed' } });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_RUNNING_MS);
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS - POLL_RUNNING_MS);
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(2);
  });

  it('polls every minute while a watched PR has CI running', async () => {
    serve({ 'a/b#1': { ciStatus: 'running' } });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_RUNNING_MS);
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(2);
  });

  it('never polls merged or closed PRs: their CI can no longer change', async () => {
    serve({ 'a/b#1': { state: 'MERGED', ciStatus: 'none' } });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while the tab is hidden and refetches when it comes back', async () => {
    serve({ 'a/b#1': { ciStatus: 'running' } });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(POLL_RUNNING_MS * 3);
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(2);
  });

  it('stops polling a PR once its last chip unmounts', async () => {
    serve({ 'a/b#1': { ciStatus: 'running' } });
    const unsubscribe = usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    expect(api.fetchPRCiSummaries).toHaveBeenCalledTimes(1);
    // Cached for an instant re-display.
    expect(usePrCiStore.getState().summaries['a/b#1']).toBeDefined();
  });
});

describe('prCiStore merge', () => {
  it('marks the PR merged right away so every chip for it turns purple, then refetches', async () => {
    serve({ 'a/b#1': {} });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    api.mergePR.mockResolvedValue({ ok: true });
    api.fetchPRCiSummaries.mockImplementation(() => new Promise(() => {})); // refetch never lands

    await usePrCiStore.getState().merge('a/b#1', 'squash', 'a'.repeat(40));

    expect(api.mergePR).toHaveBeenCalledWith({ ref: 'a/b#1', method: 'squash', headSha: 'a'.repeat(40) });
    expect(usePrCiStore.getState().summaries['a/b#1']!.state).toBe('MERGED');
    expect(api.fetchPRCiSummaries).toHaveBeenLastCalledWith(['a/b#1']);
  });

  it('leaves the PR open and rethrows gh refusal for the dialog to show', async () => {
    serve({ 'a/b#1': {} });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    api.mergePR.mockRejectedValue(new Error('Head branch was modified'));

    await expect(usePrCiStore.getState().merge('a/b#1', 'merge', 'a'.repeat(40))).rejects.toThrow('Head branch was modified');
    expect(usePrCiStore.getState().summaries['a/b#1']!.state).toBe('OPEN');
  });
});

describe('prCiStore detail', () => {
  it('keeps the summary in step with a freshly loaded detail', async () => {
    serve({ 'a/b#1': { ciStatus: 'running' } });
    usePrCiStore.getState().subscribe(['a/b#1']);
    await flush();
    api.fetchPRCiDetail.mockResolvedValue({ ...summary('a/b#1', { ciStatus: 'failed', counts: { fail: 1 } }), checks: [] });

    await usePrCiStore.getState().loadDetail('a/b#1');
    expect(usePrCiStore.getState().summaries['a/b#1']!.ciStatus).toBe('failed');
    expect(usePrCiStore.getState().details['a/b#1']!.loading).toBe(false);
  });
});
