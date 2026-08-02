import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIENT_ERROR_MAX_MESSAGE, CLIENT_ERROR_MAX_PER_PAGE } from '@fleex/shared';
import {
  reportClientError,
  installGlobalErrorHandlers,
  generateErrorId,
  __resetErrorReporterForTests,
} from './errorReporter';

/**
 * The reporter runs while the app is already broken. These tests encode the
 * three properties that make it safe to call from `componentDidCatch`:
 * it cannot flood the server, it cannot throw, and it does not route through
 * the toast-raising `api.ts` wrapper.
 */

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call![1] as RequestInit).body as string);
}

describe('errorReporter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetErrorReporterForTests();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the crash to /api/client-errors with the triage fields', () => {
    const errorId = reportClientError({
      error: new Error('kaboom'),
      source: 'boundary',
      boundary: 'main-view',
      viewKey: 'analytics',
      componentStack: '\n    at AnalyticsPanel',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/client-errors');

    const body = lastRequestBody(fetchMock);
    expect(body.errorId).toBe(errorId);
    expect(body.message).toBe('kaboom');
    expect(body.source).toBe('boundary');
    expect(body.boundary).toBe('main-view');
    expect(body.viewKey).toBe('analytics');
    expect(body.componentStack).toContain('AnalyticsPanel');
    expect(body.seq).toBe(1);
  });

  it('returns the caller-supplied errorId so the crash screen shows what was sent', () => {
    const returned = reportClientError({ error: new Error('x'), source: 'boundary', errorId: 'err_deadbeef' });
    expect(returned).toBe('err_deadbeef');
    expect(lastRequestBody(fetchMock).errorId).toBe('err_deadbeef');
  });

  // ── Guardrails: a crash loop must not become a DoS ──

  it('reports an identical crash only once (dedup)', () => {
    // Same message AND same stack: one bug firing twice, not two bugs.
    const err = new Error('same');
    reportClientError({ error: err, source: 'boundary', boundary: 'main-view' });
    reportClientError({ error: err, source: 'boundary', boundary: 'main-view' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats the same message in a different boundary as a distinct crash', () => {
    const err = new Error('same');
    reportClientError({ error: err, source: 'boundary', boundary: 'main-view' });
    reportClientError({ error: err, source: 'boundary', boundary: 'nav-sidebar' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after the per-page cap, however many distinct crashes occur', () => {
    for (let i = 0; i < CLIENT_ERROR_MAX_PER_PAGE + 5; i++) {
      reportClientError({ error: new Error(`distinct ${i}`), source: 'boundary' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(CLIENT_ERROR_MAX_PER_PAGE);
  });

  it('never throws when the transport itself fails', () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(() => reportClientError({ error: new Error('boom'), source: 'boundary' })).not.toThrow();
  });

  it('never throws when fetch rejects asynchronously', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(() => reportClientError({ error: new Error('boom'), source: 'boundary' })).not.toThrow();
    // Give the rejected promise a tick — an unhandled rejection would fail the run.
    await Promise.resolve();
  });

  it('truncates an oversized message instead of shipping it whole', () => {
    reportClientError({ error: new Error('x'.repeat(CLIENT_ERROR_MAX_MESSAGE + 500)), source: 'boundary' });
    expect((lastRequestBody(fetchMock).message as string).length).toBe(CLIENT_ERROR_MAX_MESSAGE);
  });

  it('handles non-Error throws (`throw "boom"`) without losing the report', () => {
    reportClientError({ error: 'plain string boom', source: 'window.onerror' });
    expect(lastRequestBody(fetchMock).message).toBe('plain string boom');
  });

  it('generates distinct ids', () => {
    expect(generateErrorId()).not.toBe(generateErrorId());
    expect(generateErrorId()).toMatch(/^err_[0-9a-f]{8}$/);
  });
});

describe('installGlobalErrorHandlers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetErrorReporterForTests();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unhandled promise rejections — the class of failure boundaries cannot see', () => {
    installGlobalErrorHandlers();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new Error('background load failed') });
    window.dispatchEvent(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastRequestBody(fetchMock);
    expect(body.source).toBe('unhandledrejection');
    expect(body.message).toBe('background load failed');
  });

  it('is idempotent, so StrictMode double-mount does not double-report', () => {
    installGlobalErrorHandlers();
    installGlobalErrorHandlers();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new Error('once') });
    window.dispatchEvent(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
