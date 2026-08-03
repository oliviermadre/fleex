import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { __resetErrorReporterForTests } from '../../services/errorReporter';

import { ErrorBoundary } from './ErrorBoundary';

/**
 * The boundary exists so a render crash costs one region instead of the whole
 * app. These tests pin the three behaviours that make that true: it catches,
 * it reports, and it can be recovered from without a page reload.
 */

function Boom(): never {
  throw new Error('render exploded');
}

/**
 * Throws while an externally-controlled condition holds — models a transient
 * failure (server down, bad cache entry) that the user resolves before retrying.
 *
 * The condition must NOT self-clear on first throw: React 19 recovers from a
 * failed concurrent render by re-rendering synchronously, so a self-clearing
 * component silently succeeds on the retry and never reaches the boundary.
 */
function makeFlaky() {
  const state = { broken: true };
  function Flaky() {
    if (state.broken) throw new Error('transient');
    return <div>healthy content</div>;
  }
  return { Flaky, state };
}

describe('ErrorBoundary', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetErrorReporterForTests();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    // React logs every caught error; silence it so the run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary name="main-view">
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('shows the crash screen instead of unmounting to a blank page', () => {
    render(
      <ErrorBoundary name="main-view">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('This view crashed')).toBeTruthy();
  });

  it('reports the crash with the boundary and view context needed to triage it', () => {
    render(
      <ErrorBoundary name="main-view" viewKey="analytics">
        <Boom />
      </ErrorBoundary>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.message).toBe('render exploded');
    expect(body.source).toBe('boundary');
    expect(body.boundary).toBe('main-view');
    expect(body.viewKey).toBe('analytics');
    expect(body.componentStack).toBeTruthy();
    // The id on screen must match the id in the log, or user reports are useless.
    expect(screen.getByTestId('error-id').textContent).toBe(body.errorId);
  });

  it('recovers the subtree on "Reload this view" without reloading the page', () => {
    const reload = vi.fn();
    // jsdom's location.reload is non-configurable on the object itself; replace
    // the whole descriptor to observe it.
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, href: original.href, reload },
    });

    const { Flaky, state } = makeFlaky();
    render(
      <ErrorBoundary name="main-view">
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This view crashed')).toBeTruthy();

    // The underlying cause goes away, then the user retries.
    state.broken = false;
    fireEvent.click(screen.getByText('Reload this view'));

    expect(screen.getByText('healthy content')).toBeTruthy();
    expect(screen.queryByText('This view crashed')).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('discards the error when the caller changes the key — how navigation resets it', () => {
    const { rerender } = render(
      <ErrorBoundary key="analytics" name="main-view" viewKey="analytics">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This view crashed')).toBeTruthy();

    // Same element type, different key: React discards the crashed instance.
    rerender(
      <ErrorBoundary key="tickets:board" name="main-view" viewKey="tickets:board">
        <div>kanban board</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('kanban board')).toBeTruthy();
    expect(screen.queryByText('This view crashed')).toBeNull();
  });

  it('uses the full-screen wording at the root, where navigating away is not an option', () => {
    render(
      <ErrorBoundary name="root" variant="root">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Fleex crashed')).toBeTruthy();
    expect(screen.getByText('Reload Fleex')).toBeTruthy();
  });

  it('uses the compact form inline, so a 200px sidebar is not blown apart', () => {
    render(
      <ErrorBoundary name="nav-sidebar" variant="inline">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This panel crashed')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
