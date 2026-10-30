import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Ticket } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';

const openTicketInWork = vi.fn();
vi.mock('../work/openInWork', () => ({ openTicketInWork: (...a: unknown[]) => openTicketInWork(...a) }));

const { KanbanCard } = await import('./KanbanCard');

const TICKET = {
  id: 't1', displayId: 7, title: 'Fix login', boardId: 'fleex', status: 'todo', priority: 'medium', type: null,
  favorite: false, blocked: false, links: [], tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Ticket;

// The card's session button lists personas / panels: nothing to fetch here.
useAgentPersonaStore.setState({ loaded: true });
usePanelStore.setState({ loaded: true });

afterEach(() => {
  cleanup();
  openTicketInWork.mockClear();
});

// The Kanban's ticket-detail screen is retired: a card opens its ticket in the
// Work view — whatever its status or board (the Work view pins it).
describe('KanbanCard — opening the ticket', () => {
  function renderCard() {
    return render(
      <MemoryRouter>
        <KanbanCard ticket={TICKET} />
      </MemoryRouter>,
    );
  }

  it('a click on the card opens the ticket in the Work view', () => {
    renderCard();
    fireEvent.click(screen.getByText('Fix login'));
    expect(openTicketInWork).toHaveBeenCalledWith('t1');
  });

  it('the comments counter opens the chat, the deliverables counter the deliverables panel', () => {
    renderCard();
    fireEvent.click(screen.getByTitle(/comments$/));
    expect(openTicketInWork).toHaveBeenLastCalledWith('t1', { mode: 'chat' });
    fireEvent.click(screen.getByTitle(/deliverables$/));
    expect(openTicketInWork).toHaveBeenLastCalledWith('t1', { rightPanel: 'deliv' });
  });
});
