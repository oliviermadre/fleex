import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { HumanGateResolvePanel } from './HumanGateResolvePanel';

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

function typeNote(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

describe('HumanGateResolvePanel note persistence', () => {
  it('preserves the typed note across unmount/remount (tab/view switch)', () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const first = render(
      <HumanGateResolvePanel
        runId="run1"
        stepRunId="step1"
        outcomes={['approve', 'reject']}
        onResolve={onResolve}
      />,
    );
    typeNote(first.container.querySelector('textarea')!, 'looks good to me');
    first.unmount();

    const second = render(
      <HumanGateResolvePanel
        runId="run1"
        stepRunId="step1"
        outcomes={['approve', 'reject']}
        onResolve={onResolve}
      />,
    );
    expect(second.container.querySelector('textarea')!.value).toBe('looks good to me');
  });

  it('scopes the draft per gate instance (different stepRunId → different draft)', () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const { container, rerender } = render(
      <HumanGateResolvePanel
        runId="run1"
        stepRunId="stepA"
        outcomes={['approve']}
        onResolve={onResolve}
      />,
    );
    typeNote(container.querySelector('textarea')!, 'note for A');

    // Switch to a different gate instance while mounted.
    rerender(
      <HumanGateResolvePanel
        runId="run1"
        stepRunId="stepB"
        outcomes={['approve']}
        onResolve={onResolve}
      />,
    );
    expect(container.querySelector('textarea')!.value).toBe('');
  });

  it('clears the draft after a successful resolve', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <HumanGateResolvePanel
        runId="run1"
        stepRunId="step1"
        outcomes={['approve']}
        onResolve={onResolve}
      />,
    );
    typeNote(container.querySelector('textarea')!, 'my rationale');
    await act(async () => {
      fireEvent.click(getByText('approve'));
    });

    expect(onResolve).toHaveBeenCalledWith('approve', 'my rationale');
    expect(localStorage.getItem('human_gate_note_run1_step1')).toBeNull();
  });

  it('keeps the draft when resolving fails (does not lose the note)', async () => {
    const onResolve = vi.fn().mockRejectedValue(new Error('network'));
    const { container, getByText } = render(
      <HumanGateResolvePanel
        runId="run1"
        stepRunId="step1"
        outcomes={['approve']}
        onResolve={onResolve}
      />,
    );
    typeNote(container.querySelector('textarea')!, 'precious note');
    await act(async () => {
      fireEvent.click(getByText('approve'));
    });

    expect(localStorage.getItem('human_gate_note_run1_step1')).toBe('precious note');
    expect(container.querySelector('textarea')!.value).toBe('precious note');
  });
});
