import { describe, it, expect, beforeEach } from 'vitest';
import { useConfirmStore } from './confirmStore';

describe('confirmStore', () => {
  beforeEach(() => {
    useConfirmStore.setState({ request: null, resolve: null });
  });

  it('resolves true and clears the request when confirmed', async () => {
    // WHY: this is the "OK" branch of the native confirm() it replaces — the
    // caller's guarded action must run, then the modal must disappear.
    const promise = useConfirmStore.getState().confirm({ title: 'Delete ticket' });
    expect(useConfirmStore.getState().request).not.toBeNull();

    useConfirmStore.getState().handleConfirm();

    await expect(promise).resolves.toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
    expect(useConfirmStore.getState().resolve).toBeNull();
  });

  it('resolves false when cancelled (Escape / backdrop / Cancel parity)', async () => {
    // WHY: the native confirm() returns false on dismissal; every dismissal path
    // (Escape, backdrop, Cancel button) funnels through handleCancel and must be a no-op.
    const promise = useConfirmStore.getState().confirm({ title: 'Delete ticket' });

    useConfirmStore.getState().handleCancel();

    await expect(promise).resolves.toBe(false);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('supersedes a pending request by resolving the previous one false', async () => {
    // WHY: only one modal shows at a time. If a second confirm is triggered before
    // the first is answered, the abandoned promise must settle (false) rather than hang.
    const first = useConfirmStore.getState().confirm({ title: 'First' });
    const second = useConfirmStore.getState().confirm({ title: 'Second' });

    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().request?.title).toBe('Second');

    useConfirmStore.getState().handleConfirm();
    await expect(second).resolves.toBe(true);
  });
});
