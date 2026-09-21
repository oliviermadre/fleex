import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useBrowseResource, prefetchBrowseResource, resetBrowseResources } from './useBrowseResource';

interface Payload {
  value: string;
  stale: boolean;
}

beforeEach(() => resetBrowseResources());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useBrowseResource', () => {
  it('shows a prefetched answer at once: opening a picker must not start with a spinner', async () => {
    const fetcher = vi.fn(async (): Promise<Payload> => ({ value: 'warm', stale: false }));
    await prefetchBrowseResource('inbox', fetcher);

    const { result } = renderHook(() => useBrowseResource('inbox', fetcher));

    expect(result.current.data?.value).toBe('warm');
    expect(result.current.loading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1); // fresh enough: not refetched on mount
  });

  it('shares one request between the prefetch and every consumer mounted meanwhile', async () => {
    let release!: (p: Payload) => void;
    const fetcher = vi.fn(() => new Promise<Payload>((r) => (release = r)));

    void prefetchBrowseResource('inbox', fetcher);
    const a = renderHook(() => useBrowseResource('inbox', fetcher));
    const b = renderHook(() => useBrowseResource('inbox', fetcher));
    expect(a.result.current.loading).toBe(true);

    await act(async () => release({ value: 'once', stale: false }));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.result.current.data?.value).toBe('once');
    expect(b.result.current.data?.value).toBe('once');
  });

  it('stops after a failure instead of hammering the endpoint, and retries only when asked', async () => {
    // Regression guard: the first browse panel refetched in a loop on error.
    const fetcher = vi.fn(async (): Promise<Payload> => {
      throw new Error('GitHub is down');
    });

    const { result } = renderHook(() => useBrowseResource('inbox', fetcher));
    await waitFor(() => expect(result.current.error).toBe('GitHub is down'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockImplementationOnce(async () => ({ value: 'back', stale: false }));
    await act(async () => result.current.retry());

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.value).toBe('back');
  });

  it('keeps the rows on screen when a refresh fails: old data beats an error page', async () => {
    const fetcher = vi.fn(async (): Promise<Payload> => ({ value: 'kept', stale: false }));
    const { result } = renderHook(() => useBrowseResource('inbox', fetcher));
    await waitFor(() => expect(result.current.data?.value).toBe('kept'));

    fetcher.mockImplementationOnce(async () => {
      throw new Error('blip');
    });
    await act(async () => result.current.retry());

    expect(result.current.data?.value).toBe('kept');
    expect(result.current.error).toBe('blip');
  });

  it('asks again shortly after a stale answer, to pick up the refresh running on the server', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<() => Promise<Payload>>()
      .mockResolvedValueOnce({ value: 'old', stale: true })
      .mockResolvedValueOnce({ value: 'new', stale: false });

    const { result } = renderHook(() => useBrowseResource('inbox', fetcher));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.value).toBe('old');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(result.current.data?.value).toBe('new');
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2); // fresh now: no more polling
  });

  it('does nothing without a key (no repo picked yet)', () => {
    const fetcher = vi.fn(async (): Promise<Payload> => ({ value: 'x', stale: false }));

    const { result } = renderHook(() => useBrowseResource(null, fetcher));

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
  });
});
