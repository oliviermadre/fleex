import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { useNotificationStore } from './notificationStore';

import type { PulseNotification } from '../notifications/types';

function makeNotification(
  id: string,
  overrides: Partial<PulseNotification> = {},
): PulseNotification {
  return {
    id,
    emoji: '🔔',
    title: `Title ${id}`,
    body: `Body ${id}`,
    level: 'info',
    link: `/t/${id}`,
    ticketId: null,
    createdAt: '2026-06-04T00:00:00.000Z',
    seen: false,
    ...overrides,
  };
}

const reset = () =>
  useNotificationStore.setState({
    notifications: [],
    toasts: [],
    panelOpen: false,
    unseenCount: 0,
    processedKeys: new Set<string>(),
  });

describe('notificationStore', () => {
  beforeEach(reset);

  it('pushes a notification onto the list and a toast, and bumps the badge', () => {
    useNotificationStore.getState().push(makeNotification('a'));
    const s = useNotificationStore.getState();
    expect(s.notifications).toHaveLength(1);
    expect(s.toasts).toHaveLength(1);
    expect(s.unseenCount).toBe(1);
  });

  it('deduplicates by id (hub re-broadcast / "announce once")', () => {
    const { push } = useNotificationStore.getState();
    push(makeNotification('dup'));
    push(makeNotification('dup'));
    const s = useNotificationStore.getState();
    expect(s.notifications).toHaveLength(1);
    expect(s.unseenCount).toBe(1);
  });

  it('keeps newest first', () => {
    const { push } = useNotificationStore.getState();
    push(makeNotification('first'));
    push(makeNotification('second'));
    expect(useNotificationStore.getState().notifications[0]!.id).toBe('second');
  });

  it('opening the panel marks everything seen and clears the badge', () => {
    const { push, openPanel } = useNotificationStore.getState();
    push(makeNotification('a'));
    push(makeNotification('b'));
    expect(useNotificationStore.getState().unseenCount).toBe(2);

    openPanel();
    const s = useNotificationStore.getState();
    expect(s.panelOpen).toBe(true);
    expect(s.unseenCount).toBe(0);
    expect(s.notifications.every((n) => n.seen)).toBe(true);
  });

  it('does not inflate the badge for pushes while the panel is open', () => {
    const { openPanel, push } = useNotificationStore.getState();
    openPanel();
    push(makeNotification('live'));
    const s = useNotificationStore.getState();
    expect(s.unseenCount).toBe(0);
    expect(s.notifications[0]!.seen).toBe(true);
  });

  it('keeps the badge coherent when an unseen entry is evicted by the cap', () => {
    const { push } = useNotificationStore.getState();
    // MAX_NOTIFICATIONS is 50 — push 60 distinct unseen notifications.
    for (let i = 0; i < 60; i++) push(makeNotification(`n${i}`));
    const s = useNotificationStore.getState();
    expect(s.notifications).toHaveLength(50);
    // Badge reflects the capped list, not the total ever pushed.
    expect(s.unseenCount).toBe(50);
  });

  it('caps the number of visible toasts', () => {
    const { push } = useNotificationStore.getState();
    for (let i = 0; i < 6; i++) push(makeNotification(`t${i}`));
    const s = useNotificationStore.getState();
    expect(s.toasts).toHaveLength(4); // MAX_TOASTS
    expect(s.notifications).toHaveLength(6);
  });

  it('dismissToast removes a toast but leaves the persistent entry', () => {
    const { push, dismissToast } = useNotificationStore.getState();
    push(makeNotification('keep'));
    dismissToast('keep');
    const s = useNotificationStore.getState();
    expect(s.toasts).toHaveLength(0);
    expect(s.notifications).toHaveLength(1);
  });

  it('clear empties the list and toasts but still deduplicates afterwards', () => {
    const { push, clear } = useNotificationStore.getState();
    push(makeNotification('x'));
    clear();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(useNotificationStore.getState().unseenCount).toBe(0);
    // Same event id arriving again (e.g. reconnect re-broadcast) is not re-added.
    push(makeNotification('x'));
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('togglePanel opens (marking seen) then closes', () => {
    const { push, togglePanel } = useNotificationStore.getState();
    push(makeNotification('a'));
    togglePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(true);
    expect(useNotificationStore.getState().unseenCount).toBe(0);
    togglePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(false);
  });

  describe('hydrate', () => {
    it('seeds history as already-seen (no badge spike) and without toasts', () => {
      useNotificationStore
        .getState()
        .hydrate([
          makeNotification('h1', { createdAt: '2026-06-01T00:00:00.000Z' }),
          makeNotification('h2', { createdAt: '2026-06-02T00:00:00.000Z' }),
        ]);
      const s = useNotificationStore.getState();
      expect(s.notifications).toHaveLength(2);
      expect(s.notifications.every((n) => n.seen)).toBe(true);
      expect(s.unseenCount).toBe(0);
      expect(s.toasts).toHaveLength(0);
    });

    it('orders the merged list newest-first by createdAt', () => {
      useNotificationStore
        .getState()
        .hydrate([
          makeNotification('older', { createdAt: '2026-06-01T00:00:00.000Z' }),
          makeNotification('newer', { createdAt: '2026-06-03T00:00:00.000Z' }),
        ]);
      expect(useNotificationStore.getState().notifications[0]!.id).toBe('newer');
    });

    it('does not duplicate a hydrated entry that already arrived live', () => {
      // live push first (unseen), then hydrate the same id from the audit trail
      useNotificationStore.getState().push(makeNotification('shared'));
      useNotificationStore.getState().hydrate([makeNotification('shared')]);
      const s = useNotificationStore.getState();
      expect(s.notifications).toHaveLength(1);
      // the live entry keeps its unseen state — hydrate must not overwrite it
      expect(s.unseenCount).toBe(1);
      expect(s.notifications[0]!.seen).toBe(false);
    });

    it('registers hydrated ids for dedup so a later live broadcast is collapsed', () => {
      useNotificationStore.getState().hydrate([makeNotification('past')]);
      useNotificationStore.getState().push(makeNotification('past'));
      const s = useNotificationStore.getState();
      expect(s.notifications).toHaveLength(1);
      expect(s.unseenCount).toBe(0); // stayed seen; the live twin was deduped away
    });

    it('caps the merged history at MAX_NOTIFICATIONS', () => {
      const many = Array.from({ length: 60 }, (_, i) =>
        makeNotification(`h${i}`, {
          createdAt: `2026-06-04T00:00:${String(i).padStart(2, '0')}.000Z`,
        }),
      );
      useNotificationStore.getState().hydrate(many);
      expect(useNotificationStore.getState().notifications).toHaveLength(50);
    });
  });

  describe('auto-dismiss', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('removes the toast after the timeout but keeps the entry', () => {
      reset();
      useNotificationStore.getState().push(makeNotification('auto'));
      expect(useNotificationStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(6_000);
      const s = useNotificationStore.getState();
      expect(s.toasts).toHaveLength(0);
      expect(s.notifications).toHaveLength(1);
    });
  });
});
