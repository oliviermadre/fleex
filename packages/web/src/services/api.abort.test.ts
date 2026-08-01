import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToastStore } from '../stores/toastStore';
import { fetchTicketComments, isAbortError, ignoreAbort } from './api';

/**
 * Two guarantees are asserted here, and they pull in opposite directions:
 *
 *  1. A cancelled request must be COMPLETELY silent — no toast, no console noise.
 *     Switching tickets aborts the previous ticket's fetches; if that produced a
 *     toast the UI would spam the user on every navigation.
 *  2. A genuinely failed request must be VISIBLE. Until now `fetch` rejecting
 *     (server down, DNS, CORS) bypassed the `!res.ok` branch entirely, so the
 *     error never reached a toast and the caller's `.catch(() => {})` swallowed
 *     the rest: a blank screen with zero diagnostics.
 *
 * The line between the two is `isAbortError`.
 */

const originalFetch = globalThis.fetch;

/** Replaces addToast with a spy so we can count calls (the store dedups by message). */
function spyOnToasts() {
  const addToast = vi.fn();
  useToastStore.setState({ addToast });
  return addToast;
}

describe('api request — abort vs. real failure', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('forwards the AbortSignal to fetch and rejects silently when aborted', async () => {
    const addToast = spyOnToasts();
    globalThis.fetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as typeof fetch;

    const ac = new AbortController();
    const promise = fetchTicketComments('t1', { signal: ac.signal });
    ac.abort();

    // If the signal were not forwarded, this promise would hang forever and the
    // test would time out — that hang IS the assertion that plumbing works.
    const err = await promise.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('surfaces a network-level failure with exactly one toast and rethrows', async () => {
    const addToast = spyOnToasts();
    // What `fetch` does when the server is unreachable: it rejects, it does not
    // resolve with a non-ok Response. The old code had no catch here at all.
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

    const err = await fetchTicketComments('t1').catch((e: unknown) => e);

    expect(isAbortError(err)).toBe(false);
    expect(err).toBeInstanceOf(TypeError);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('error', expect.stringMatching(/network/i));
  });

  it('still toasts an HTTP error exactly once (no double toast)', async () => {
    const addToast = spyOnToasts();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'boom' }), { status: 500, statusText: 'Server Error' }),
      ),
    ) as typeof fetch;

    await expect(fetchTicketComments('t1')).rejects.toThrow(/500/);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('error', 'boom');
  });
});

describe('ignoreAbort', () => {
  it('stays silent on an abort — cancellation is expected, not a failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ignoreAbort(new DOMException('The operation was aborted.', 'AbortError'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs anything else — the ticket asks that failures stop being masked', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('kaboom');
    ignoreAbort(err);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[api]'), err);
    spy.mockRestore();
  });
});
