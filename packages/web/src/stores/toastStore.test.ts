import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from './toastStore';

beforeEach(() => useToastStore.setState({ toasts: [] }));

describe('toast dedup', () => {
  it('drops a plain toast repeating a visible one', () => {
    const { addToast } = useToastStore.getState();
    addToast('error', 'Network error');
    addToast('error', 'Network error');
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('keeps every toast that carries an action — each Undo undoes its own change', () => {
    const { addToast } = useToastStore.getState();
    const first = { label: 'Undo', onClick: () => {} };
    const second = { label: 'Undo', onClick: () => {} };
    addToast('info', '“Untitled” deleted', { action: first });
    addToast('info', '“Untitled” deleted', { action: second });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(toasts[1]!.action).toBe(second);
  });
});
