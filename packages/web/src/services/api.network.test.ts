import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useToastStore } from '../stores/toastStore';

import { NetworkError, fetchSessions } from './api';

/**
 * Regression guard for the silent-failure bug.
 *
 * `request()` only ever raised a toast from its `!res.ok` branch. A transport
 * failure makes `fetch` REJECT, so that branch was never reached and every one
 * of the ~80 API functions failed with no user-visible trace whatsoever —
 * an empty sidebar and no explanation.
 */

describe('api request() — transport failures', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('raises a toast when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(fetchSessions()).rejects.toBeInstanceOf(NetworkError);

    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Cannot reach the Fleex server');
    expect(useToastStore.getState().toasts[0]!.type).toBe('error');
  });

  it('preserves the underlying failure as the cause for debugging', async () => {
    const cause = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));

    await expect(fetchSessions()).rejects.toMatchObject({ name: 'NetworkError', cause });
  });

  // At boot AppLayout fires ~11 requests at once. Without dedup, a down server
  // would stack 11 identical toasts — the fix would be worse than the bug.
  it('shows one toast, not one per concurrent request, when everything fails at once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await Promise.allSettled([fetchSessions(), fetchSessions(), fetchSessions()]);

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('still surfaces HTTP errors through the existing path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => JSON.stringify({ message: 'boom on the server' }),
      }),
    );

    // Not a NetworkError: the server answered, it just answered badly.
    await expect(fetchSessions()).rejects.not.toBeInstanceOf(NetworkError);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['boom on the server']);
  });

  it('does not toast on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }),
    );

    await expect(fetchSessions()).resolves.toEqual([]);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
