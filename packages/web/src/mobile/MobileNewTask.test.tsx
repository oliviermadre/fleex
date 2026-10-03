import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

// The desktop flow itself is covered by its own tests; here it is a stand-in that
// ends the way the real one does (Start selects the new ticket, Cancel just leaves).
vi.mock('../components/work/new/NewTask', async () => {
  const { useWorkStore } = await import('../stores/workStore');
  return {
    NewTask: () => (
      <div>
        <button onClick={() => useWorkStore.getState().selectTicket('new-ticket')}>start</button>
      </div>
    ),
  };
});

import { useWorkStore } from '../stores/workStore';
import { useTicketStore } from '../stores/ticketStore';
import { useMobileNavStore } from './mobileNavStore';
import { MobileNewTask } from './MobileNewTask';

afterEach(cleanup);

describe('MobileNewTask', () => {
  it('opens the created ticket on Conversation and closes itself', () => {
    const onClose = vi.fn();
    render(<MobileNewTask onClose={onClose} />);
    expect(useWorkStore.getState().view).toBe('new');
    fireEvent.click(screen.getByText('start'));
    expect(onClose).toHaveBeenCalled();
    expect(useTicketStore.getState().selectedTicketId).toBe('new-ticket');
    expect(useMobileNavStore.getState().requestedDetailTab).toBe('conversation');
  });

  it('closes without opening anything on cancel', () => {
    useTicketStore.setState({ selectedTicketId: null });
    useMobileNavStore.setState({ requestedDetailTab: null });
    useWorkStore.setState({ selectedTicketId: 'existing' });
    const onClose = vi.fn();
    render(<MobileNewTask onClose={onClose} />);
    fireEvent.click(screen.getByText('‹ Annuler'));
    expect(onClose).toHaveBeenCalled();
    expect(useTicketStore.getState().selectedTicketId).toBeNull();
  });
});
