import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { TicketMentionChip } from './TicketMentionChip';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';

const UUID = '05d50f27-b12e-4338-8c36-e840fd288222';

/** Minimal ticket — the chip only reads id/displayId/title. */
function ticket(id: string, displayId: number, title: string): Ticket {
  return { id, displayId, title, boardId: 'b1' } as unknown as Ticket;
}

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [], selectedTicketId: null });
});

describe('TicketMentionChip', () => {
  it('renders #<displayId> and the title when the ticket is in the store', () => {
    useTicketStore.setState({ tickets: [ticket('t1', 378, 'Mentionner des tickets')] });
    const { container } = render(<TicketMentionChip idRef="378" />);
    expect(container.textContent).toContain('#378');
    expect(container.textContent).toContain('Mentionner des tickets');
  });

  it('resolves a ticket referenced by uuid', () => {
    useTicketStore.setState({ tickets: [ticket(UUID, 378, 'By uuid')] });
    const { container } = render(<TicketMentionChip idRef={UUID} />);
    expect(container.textContent).toContain('#378');
    expect(container.textContent).toContain('By uuid');
  });

  it('degrades to plain text (no chip button) when the ticket is unknown', () => {
    const { container } = render(<TicketMentionChip idRef="999" />);
    expect(container.textContent).toContain('@ticket:999');
    expect(container.querySelector('button')).toBeNull();
  });

  it('navigates to the referenced ticket on click', () => {
    useTicketStore.setState({ tickets: [ticket('t1', 378, 'Go here')] });
    const { getByRole } = render(<TicketMentionChip idRef="378" />);
    fireEvent.click(getByRole('button'));
    expect(useTicketStore.getState().selectedTicketId).toBe('t1');
    expect(useUIStore.getState().activePanel).toBe('tickets');
  });

  it('fills in reactively once the ticket list loads', () => {
    const { container, rerender } = render(<TicketMentionChip idRef="378" />);
    expect(container.textContent).not.toContain('#378');
    act(() => {
      useTicketStore.setState({ tickets: [ticket('t1', 378, 'Late load')] });
    });
    rerender(<TicketMentionChip idRef="378" />);
    expect(container.textContent).toContain('#378');
  });
});
