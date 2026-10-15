import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { TicketDeliverable } from '@fleex/shared';

vi.mock('../../../services/api', () => ({
  fetchSeenDeliverables: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../stores/unreadStore', () => ({
  useUnreadStore: (sel: (s: unknown) => unknown) =>
    sel({
      seenDeliverablesByTicket: {},
      loadSeenDeliverables: vi.fn().mockResolvedValue(undefined),
      toggleDeliverableSeen: vi.fn().mockResolvedValue(undefined),
    }),
}));
// The modal itself is covered by the ticket detail — here we only check the
// panel opens it, for the right ticket.
vi.mock('../../tickets/DeliverableFormModal', () => ({
  DeliverableFormModal: ({ open, ticketId, onClose }: { open: boolean; ticketId: string; onClose: () => void }) =>
    open ? (
      <div role="dialog" data-ticket={ticketId}>
        <button type="button" onClick={onClose}>
          close-modal
        </button>
      </div>
    ) : null,
}));

import { DelivsPanel } from './DelivsPanel';

afterEach(cleanup);

const deliv = {
  id: 'd1',
  ticketId: 't1',
  title: 'SPEC v1',
  type: 'spec',
  status: 'final',
  version: 1,
  content: '# spec',
  agentName: 'catalyst',
  createdAt: new Date().toISOString(),
} as unknown as TicketDeliverable;

describe('DelivsPanel — manual creation', () => {
  it('lets the user add the first deliverable of a ticket that has none', () => {
    // The empty ticket is the main case: context pasted from Notion before any agent ran.
    render(<DelivsPanel ticketId="t1" deliverables={[]} />);
    expect(screen.getByText('Nothing delivered yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add deliverable' }));
    expect(screen.getByRole('dialog').getAttribute('data-ticket')).toBe('t1');
  });

  it('keeps the add action next to existing deliverables, and closes cleanly', () => {
    render(<DelivsPanel ticketId="t1" deliverables={[deliv]} />);
    expect(screen.getByText('SPEC v1')).toBeTruthy();
    expect(screen.queryByText('Nothing delivered yet.')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Add deliverable' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'close-modal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
