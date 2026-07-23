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

  it('routes a stale-closure setter to the currently rendered key (Cockpit: switch ticket, sidebar open)', () => {
    // Reproduces the Cockpit bug. TicketComments is NOT remounted when the
    // inspector switches tickets (no `key`), so a memoized handler keeps
    // calling the exact `setDraft` it captured while the FIRST ticket was on
    // screen. That captured setter MUST write to the ticket currently
    // displayed — never leak a keystroke back into the previous ticket's draft.
    let latestSet: (v: string) => void = () => {};
    function CaptureHarness({ draftKey }: { draftKey: string }) {
      const { draft, setDraft } = useDraft(draftKey);
      latestSet = setDraft;
      return <span data-testid="value">{draft}</span>;
    }

    const { rerender, getByTestId } = render(<CaptureHarness draftKey="ticketA" />);

    // Ticket A: the user types "foo".
    act(() => latestSet('foo'));
    expect(localStorage.getItem('ticketA')).toBe('foo');

    // Capture A's setter, then switch to ticket B WITHOUT unmounting
    // (sidebar stays open). B has no draft yet.
    const setterCapturedOnA = latestSet;
    rerender(<CaptureHarness draftKey="ticketB" />);
    expect(getByTestId('value').textContent).toBe('');

    // A keystroke fires through the handler captured while A was displayed.
    act(() => setterCapturedOnA('x'));

    // It must land on the ticket on screen (B); A's draft stays intact.
    expect(localStorage.getItem('ticketB')).toBe('x');
    expect(localStorage.getItem('ticketA')).toBe('foo');
    expect(getByTestId('value').textContent).toBe('x');
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
