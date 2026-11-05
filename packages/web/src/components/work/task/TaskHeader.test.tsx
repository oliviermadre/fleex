import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useTicketStore } from '../../../stores/ticketStore';
import { useToastStore } from '../../../stores/toastStore';
import { TaskHeader } from './TaskHeader';
import type { WorkTask } from '../types';

const task = { id: 't1', title: 'Foo', number: 654, boardId: 'b1' } as unknown as WorkTask;

function renderHeader() {
  render(<MemoryRouter><TaskHeader task={task} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Foo' }));
  return screen.getByLabelText('Ticket title') as HTMLInputElement;
}

beforeEach(() => useToastStore.setState({ toasts: [] }));
afterEach(cleanup);

describe('TaskHeader — rename', () => {
  it('saves the new title through the ticket store (PATCH title only)', async () => {
    const updateTicket = vi.fn(async () => {});
    useTicketStore.setState({ updateTicket });
    const input = renderHeader();
    expect(input.maxLength).toBe(200);
    fireEvent.change(input, { target: { value: 'Bar' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(updateTicket).toHaveBeenCalledWith('t1', { title: 'Bar' });
  });

  it('a network failure restores the title and says so in a toast', async () => {
    // WHY: no silent failure — the header must not show a title the server never stored.
    useTicketStore.setState({ updateTicket: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    const input = renderHeader();
    fireEvent.change(input, { target: { value: 'Bar' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(screen.getByRole('button', { name: 'Foo' })).toBeTruthy();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['Impossible de renommer le ticket']);
  });

  it('an HTTP error (already toasted by the API layer) restores the title without a second toast', async () => {
    useTicketStore.setState({ updateTicket: vi.fn(async () => { throw new Error('API error 400: {"error":"INVALID_TICKET_TITLE"}'); }) });
    const input = renderHeader();
    fireEvent.change(input, { target: { value: 'Bar' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(screen.getByRole('button', { name: 'Foo' })).toBeTruthy();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
