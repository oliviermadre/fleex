import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import type { Ticket } from '@fleex/shared';

import { useTicketStore } from '../../stores/ticketStore';

import { NotificationCard } from './NotificationCard';

import type { PulseNotification } from '../../notifications/types';

/** Minimal ticket — the card only reads id/displayId/title. */
function ticket(id: string, displayId: number, title: string): Ticket {
  return { id, displayId, title, boardId: 'b1' } as unknown as Ticket;
}

function notif(overrides: Partial<PulseNotification> = {}): PulseNotification {
  return {
    id: 'n1',
    emoji: '📝',
    title: 'Draft deliverable posted',
    body: 'The Builder shared a draft: “Auth spec”',
    level: 'action',
    link: '/x',
    ticketId: 't1',
    createdAt: '2026-06-04T00:00:00.000Z',
    seen: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [] });
});

describe('NotificationCard ticket reference', () => {
  it('shows the ticket display id and title when the ticket is loaded', () => {
    useTicketStore.setState({ tickets: [ticket('t1', 42, 'Fix the login bug')] });
    const { container } = render(<NotificationCard notification={notif()} />);
    expect(container.textContent).toContain('#42');
    expect(container.textContent).toContain('Fix the login bug');
  });

  it('degrades gracefully (no "#", no crash) when the ticket is not in the store', () => {
    const { container } = render(<NotificationCard notification={notif()} />);
    expect(container.textContent).not.toContain('#');
    // the body is still shown — only the ticket reference line is withheld
    expect(container.textContent).toContain('The Builder shared a draft');
  });

  it('omits the reference entirely for a non-ticket-bound notification', () => {
    useTicketStore.setState({ tickets: [ticket('t1', 42, 'Fix the login bug')] });
    const { container } = render(<NotificationCard notification={notif({ ticketId: null })} />);
    expect(container.textContent).not.toContain('#42');
  });

  it('fills the reference reactively once the ticket list loads (audit-rebuild race)', () => {
    // This is the whole point of resolving at render time: the bell is rebuilt
    // from the audit trail before tickets finish loading, so the reference must
    // appear as soon as the store is populated — not stay permanently blank.
    const { container } = render(<NotificationCard notification={notif()} />);
    expect(container.textContent).not.toContain('#42');

    act(() => {
      useTicketStore.setState({ tickets: [ticket('t1', 42, 'Fix the login bug')] });
    });

    expect(container.textContent).toContain('#42');
    expect(container.textContent).toContain('Fix the login bug');
  });
});
