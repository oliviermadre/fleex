import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { ComplexityPickerPopover } from './ComplexityPickerPopover';
import { KanbanColumn } from './KanbanColumn';

const updateTicket = vi.fn().mockResolvedValue(undefined);
useTicketStore.setState({ updateTicket } as never);
// Kanban cards list personas / panels for their session button: nothing to fetch here.
useAgentPersonaStore.setState({ loaded: true });
usePanelStore.setState({ loaded: true });

afterEach(() => {
  cleanup();
  updateTicket.mockClear();
});

const ticket = (complexity: Ticket['complexity']) => ({ id: 't1', complexity });

describe('ComplexityPickerPopover', () => {
  it('shows the estimate, and a dashed dash (not 0) when not estimated', () => {
    const { rerender } = render(<ComplexityPickerPopover ticket={ticket('5')} />);
    expect(screen.getByTestId('complexity-badge').textContent).toBe('5');
    rerender(<ComplexityPickerPopover ticket={ticket(null)} />);
    expect(screen.getByTestId('complexity-badge').textContent).toBe('–');
    rerender(<ComplexityPickerPopover ticket={ticket('inf')} />);
    expect(screen.getByTestId('complexity-badge').textContent).toBe('∞');
  });

  it('opens the grid and saves the picked value', () => {
    render(<ComplexityPickerPopover ticket={ticket(null)} />);
    fireEvent.click(screen.getByLabelText('Complexity: Not estimated'));
    fireEvent.click(screen.getByLabelText('8 points'));
    expect(updateTicket).toHaveBeenCalledWith('t1', { complexity: '8' });
    expect(screen.queryByLabelText('8 points')).toBeNull();
  });

  it('does not write when the current value is picked again', () => {
    // Re-sending the same value would be a no-op PATCH; skip it altogether.
    render(<ComplexityPickerPopover ticket={ticket('3')} />);
    fireEvent.click(screen.getByLabelText('Complexity: 3 pts'));
    fireEvent.click(screen.getByLabelText('3 points'));
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it('is keyboard-driven: arrows move, Enter picks, Backspace clears', async () => {
    render(<ComplexityPickerPopover ticket={ticket('1')} />);
    fireEvent.click(screen.getByLabelText('Complexity: 1 pts'));
    const one = screen.getByLabelText('1 points');
    await act(async () => one.focus());
    fireEvent.keyDown(one, { key: 'ArrowDown' }); // 1 → 8 (one row down in the 4-wide grid)
    expect(document.activeElement).toBe(screen.getByLabelText('8 points'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }); // 8 → 13
    expect(document.activeElement).toBe(screen.getByLabelText('13 points'));
    fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    expect(updateTicket).toHaveBeenCalledWith('t1', { complexity: null });
  });
});

describe('KanbanColumn complexity sum', () => {
  const card = (id: string, complexity: Ticket['complexity']) =>
    ({
      id, displayId: Number(id.slice(1)), title: id, boardId: 'b', status: 'todo', priority: 'none', type: null,
      complexity, favorite: false, blocked: false, links: [], tags: [], statusChangedAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }) as unknown as Ticket;

  it('sums the visible tickets, flagging ∞ apart', () => {
    render(<KanbanColumn status="todo" boardId="b" tickets={[card('t1', '5'), card('t2', '0.5'), card('t3', 'inf'), card('t4', null)]} />);
    expect(screen.getByTestId('column-complexity-sum').textContent).toBe('5.5 pts + ∞');
  });

  it('shows no sum when no ticket is estimated', () => {
    render(<KanbanColumn status="todo" boardId="b" tickets={[card('t1', null)]} />);
    expect(screen.queryByTestId('column-complexity-sum')).toBeNull();
  });

  it('keeps the collapsed column free of the sum', () => {
    render(<KanbanColumn status="todo" boardId="b" collapsed tickets={[card('t1', '5')]} />);
    expect(screen.queryByTestId('column-complexity-sum')).toBeNull();
  });
});
