import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useDraft } from './useDraft';

/** Test harness that surfaces the hook's API onto the DOM and a ref. */
function Harness({ draftKey }: { draftKey: string }) {
  const { draft, setDraft, clearDraft } = useDraft(draftKey);
  return (
    <div>
      <span data-testid="value">{draft}</span>
      <button data-testid="set" onClick={() => setDraft('hello')}>
        set
      </button>
      <button data-testid="clear" onClick={() => clearDraft()}>
        clear
      </button>
    </div>
  );
}

/**
 * In-memory localStorage stub. Node 22's experimental global `localStorage`
 * shadows jsdom's, so we install a clean, deterministic store for these tests.
 */
function installMemoryStorage(): Storage {
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
  return mock;
}

beforeEach(() => {
  installMemoryStorage();
});

afterEach(() => {
  cleanup();
});

describe('useDraft', () => {
  it('reads the initial value from localStorage on mount', () => {
    localStorage.setItem('k1', 'persisted');
    const { getByTestId } = render(<Harness draftKey="k1" />);
    expect(getByTestId('value').textContent).toBe('persisted');
  });

  it('writes to localStorage when a value is set', () => {
    const { getByTestId } = render(<Harness draftKey="k1" />);
    act(() => getByTestId('set').click());
    expect(getByTestId('value').textContent).toBe('hello');
    expect(localStorage.getItem('k1')).toBe('hello');
  });

  it('survives unmount/remount (tab/view switch) via localStorage', () => {
    const first = render(<Harness draftKey="k1" />);
    act(() => first.getByTestId('set').click());
    first.unmount();

    const second = render(<Harness draftKey="k1" />);
    expect(second.getByTestId('value').textContent).toBe('hello');
  });

  it('removes the key from localStorage when cleared', () => {
    const { getByTestId } = render(<Harness draftKey="k1" />);
    act(() => getByTestId('set').click());
    act(() => getByTestId('clear').click());
    expect(getByTestId('value').textContent).toBe('');
    expect(localStorage.getItem('k1')).toBeNull();
  });

  it('re-reads the draft when the key changes while mounted (per-instance scoping)', () => {
    localStorage.setItem('gateA', 'note A');
    localStorage.setItem('gateB', 'note B');
    const { getByTestId, rerender } = render(<Harness draftKey="gateA" />);
    expect(getByTestId('value').textContent).toBe('note A');

    rerender(<Harness draftKey="gateB" />);
    expect(getByTestId('value').textContent).toBe('note B');
  });

  it('does not crash when localStorage is unavailable', () => {
    const mock = installMemoryStorage();
    vi.spyOn(mock, 'getItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.spyOn(mock, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const { getByTestId } = render(<Harness draftKey="k1" />);
    expect(getByTestId('value').textContent).toBe('');
    act(() => getByTestId('set').click());
    expect(getByTestId('value').textContent).toBe('hello');
  });
});
