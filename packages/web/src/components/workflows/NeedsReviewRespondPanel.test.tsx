import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { NeedsReviewRespondPanel } from './NeedsReviewRespondPanel';

/** In-memory localStorage (Node 22's experimental global shadows jsdom's). */
function installMemoryStorage() {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installMemoryStorage();
});

afterEach(() => {
  cleanup();
});

function typeResponse(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

describe('NeedsReviewRespondPanel response persistence', () => {
  it('preserves the typed response across unmount/remount (tab/view switch)', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const first = render(
      <NeedsReviewRespondPanel
        runId="run1"
        stepRunId="step1"
        question="What do you think?"
        onSubmit={onSubmit}
      />,
    );
    typeResponse(first.container.querySelector('textarea')!, 'here is my answer');
    first.unmount();

    const second = render(
      <NeedsReviewRespondPanel
        runId="run1"
        stepRunId="step1"
        question="What do you think?"
        onSubmit={onSubmit}
      />,
    );
    expect(second.container.querySelector('textarea')!.value).toBe('here is my answer');
  });

  it('scopes the draft per step instance (different stepRunId → different draft)', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container, rerender } = render(
      <NeedsReviewRespondPanel runId="run1" stepRunId="stepA" question="Q" onSubmit={onSubmit} />,
    );
    typeResponse(container.querySelector('textarea')!, 'response for A');

    // Switch to a different step instance while mounted.
    rerender(
      <NeedsReviewRespondPanel runId="run1" stepRunId="stepB" question="Q" onSubmit={onSubmit} />,
    );
    expect(container.querySelector('textarea')!.value).toBe('');
  });

  it('clears the draft after a successful submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <NeedsReviewRespondPanel runId="run1" stepRunId="step1" question="Q" onSubmit={onSubmit} />,
    );
    typeResponse(container.querySelector('textarea')!, 'my answer');
    await act(async () => {
      fireEvent.click(getByText('Send & retry'));
    });

    expect(onSubmit).toHaveBeenCalledWith('my answer');
    expect(localStorage.getItem('needs_review_response_run1_step1')).toBeNull();
  });

  it('keeps the draft when submit fails (does not lose the response)', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network'));
    const { container, getByText } = render(
      <NeedsReviewRespondPanel runId="run1" stepRunId="step1" question="Q" onSubmit={onSubmit} />,
    );
    typeResponse(container.querySelector('textarea')!, 'precious answer');
    await act(async () => {
      fireEvent.click(getByText('Send & retry'));
    });

    expect(localStorage.getItem('needs_review_response_run1_step1')).toBe('precious answer');
    expect(container.querySelector('textarea')!.value).toBe('precious answer');
  });
});
