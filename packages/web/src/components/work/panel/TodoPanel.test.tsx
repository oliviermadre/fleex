/**
 * The Todo tool window — what the human relies on during QA: see what is left,
 * check / reopen an item, know who did what, and never lose an agent's item by
 * a stray click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import type { TicketTodoItem } from '@fleex/shared';

const api = vi.hoisted(() => ({
  fetchTicketTodos: vi.fn(),
  createTicketTodo: vi.fn(),
  updateTicketTodo: vi.fn(),
  deleteTicketTodo: vi.fn(),
  fetchTicketTodoEvents: vi.fn(),
}));
vi.mock('../../../services/api', () => api);

const ws = vi.hoisted(() => ({ handler: null as ((msg: { type: string; data: unknown }) => void) | null }));
vi.mock('../../../services/websocket', () => ({
  appWs: { onChannel: (_c: string, h: (msg: { type: string; data: unknown }) => void) => { ws.handler = h; return () => {}; } },
}));

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/toast', () => ({ toast: { info: toastInfo, error: vi.fn(), success: vi.fn() } }));

import { TodoPanel, pastedItems } from './TodoPanel';
import { openTodoCount, useTodoStore } from '../../../stores/todoStore';

const item = (ref: number, over: Partial<TicketTodoItem> = {}): TicketTodoItem => ({
  id: `i${ref}`, ticketId: 't1', ref, text: `Item ${ref}`, note: null, state: 'open', position: ref,
  createdByType: 'agent', createdByName: 'Catalyst', stateChangedAt: null, stateChangedByType: null, stateChangedByName: null,
  cancelReason: null, createdAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:00:00.000Z', ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  toastInfo.mockReset();
  useTodoStore.setState({ byTicket: {}, loadError: {}, flashing: {} });
});
afterEach(cleanup);

describe('TodoPanel', () => {
  it('invites to start a list when the ticket has none', async () => {
    api.fetchTicketTodos.mockResolvedValue([]);
    render(<TodoPanel ticketId="t1" />);
    expect(await screen.findByText(/Pas de todo sur ce ticket/)).toBeTruthy();
  });

  it('shows open items, who closed done ones, and folds cancelled ones', async () => {
    api.fetchTicketTodos.mockResolvedValue([
      item(1),
      item(2, { state: 'done', stateChangedAt: '2026-11-03T14:02:00.000Z', stateChangedByType: 'agent', stateChangedByName: 'Builder' }),
      item(3, { state: 'cancelled', stateChangedAt: '2026-11-03T15:00:00.000Z', stateChangedByType: 'user', stateChangedByName: 'nas', cancelReason: 'doublon' }),
    ]);
    render(<TodoPanel ticketId="t1" />);
    expect(await screen.findByText('Item 1')).toBeTruthy();
    expect(screen.getByText(/1 fait · 1 à faire · 1 annulé/)).toBeTruthy();
    expect(screen.getByText(/fait par/).textContent).toContain('Builder');
    // Cancelled is folded by default: the item is not rendered until unfolded.
    expect(screen.queryByText('Item 3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Annulé \(1\)/ }));
    expect(screen.getByText('Item 3')).toBeTruthy();
    expect(screen.getByText(/« doublon »/)).toBeTruthy();
  });

  it('checks an item at once (optimistic) and offers Undo', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    api.updateTicketTodo.mockResolvedValue({ item: item(1, { state: 'done', stateChangedByName: 'nas', stateChangedByType: 'user', stateChangedAt: '2026-11-03T10:00:00.000Z' }), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Marquer #1 fait' }));
    expect(api.updateTicketTodo).toHaveBeenCalledWith('t1', 'i1', { state: 'done' });
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('#1 fait', expect.objectContaining({ action: expect.anything() })));
    // Undo puts it back to its previous state.
    api.updateTicketTodo.mockResolvedValue({ item: item(1), history: [{}] });
    toastInfo.mock.calls[0]![1].action.onClick();
    expect(api.updateTicketTodo).toHaveBeenLastCalledWith('t1', 'i1', { state: 'open' });
  });

  it('adds an item on Enter and keeps the focus to chain entries', async () => {
    api.fetchTicketTodos.mockResolvedValue([]);
    api.createTicketTodo.mockResolvedValue({ item: item(1, { text: 'Nouveau', createdByType: 'user', createdByName: 'nas' }), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    const input = await screen.findByRole('textbox', { name: 'Ajouter un item à la todo' });
    fireEvent.change(input, { target: { value: 'Nouveau' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.createTicketTodo).toHaveBeenCalledWith('t1', { text: 'Nouveau' }));
    expect(await screen.findByText('Nouveau')).toBeTruthy();
  });

  it('asks before deleting an item an agent created', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByText(/a été créé par/)).toBeTruthy();
    expect(api.deleteTicketTodo).not.toHaveBeenCalled();
  });

  it('deletes your own item only once its Undo toast is gone', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { createdByType: 'user', createdByName: 'nas' })]);
    api.deleteTicketTodo.mockResolvedValue({ item: item(1), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(screen.queryByText('Item 1')).toBeNull();
    expect(api.deleteTicketTodo).not.toHaveBeenCalled();
    await act(async () => toastInfo.mock.calls[0]![1].onDismiss('timeout'));
    expect(api.deleteTicketTodo).toHaveBeenCalledWith('t1', 'i1');
  });

  it('follows an agent checking an item from its CLI, live', async () => {
    // #7: an item this tab never wrote, so its WS echo is someone else's change.
    api.fetchTicketTodos.mockResolvedValue([item(7)]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 7');
    act(() => ws.handler!({
      type: 'todo:updated',
      data: item(7, { state: 'done', stateChangedByType: 'agent', stateChangedByName: 'Builder', stateChangedAt: '2026-11-03T14:02:00.000Z' }),
    }));
    expect(screen.getByRole('checkbox', { name: 'Repasser #7 à faire' })).toBeTruthy();
    expect(useTodoStore.getState().flashing.i7).toBe(true);
    expect(openTodoCount(useTodoStore.getState().byTicket.t1)).toBe(0);
  });

  it('shows who changed what in the history view', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    api.fetchTicketTodoEvents.mockResolvedValue([{
      id: 'e1', itemId: 'i1', ticketId: 't1', itemRef: 1, itemText: 'Item 1', action: 'state_changed',
      changes: { state: { from: 'open', to: 'done' } }, actorType: 'agent', actorName: 'Builder', source: 'mcp', createdAt: '2026-11-03T14:02:00.000Z',
    }]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    fireEvent.click(screen.getByRole('button', { name: '⟲ Historique' }));
    expect(await screen.findByText('mcp')).toBeTruthy();
    expect(screen.getByText('Builder')).toBeTruthy();
    expect(screen.getByText('Fait')).toBeTruthy();
  });
});

describe('pastedItems', () => {
  it('turns a pasted checklist into one item per line', () => {
    expect(pastedItems('- [ ] Un\n\n2. Deux\n* Trois')).toEqual(['Un', 'Deux', 'Trois']);
  });
});
