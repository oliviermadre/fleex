import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BoardWithCounts, Ticket } from '@fleex/shared';
import { FactoryDeskForm, deskDraft } from './FactoryDeskForm';
import { useTicketStore } from '../stores/ticketStore';
import { useWorkStore } from '../stores/workStore';
import { useFactoryStore } from './factoryStore';
import type { DeskSpec } from './types';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  fetchTicketGroups: vi.fn(async () => []),
}));

const board = (id: string, name: string) => ({ id, name, emoji: '📋', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }) as unknown as BoardWithCounts;
const desk: DeskSpec = { id: 'd1', kind: 'desk', x: 0, y: 0, w: 3, h: 2, name: 'Bug desk', defaults: { boardId: 'b2', type: 'fix', priority: 'high' } };
const createTicket = vi.fn(async (req: { title: string }) => ({ id: 't-new', displayId: 42, title: req.title }) as unknown as Ticket);
const transfer = vi.fn(async () => {});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useTicketStore.setState({ boards: [board('b1', 'Alpha'), board('b2', 'Beta')], tickets: [], createTicket } as never);
  useWorkStore.getState().updateDraft({ title: 'Half written in the Work view', stage: 'compose', boardId: 'b1' });
  useFactoryStore.setState({ transfer } as never);
});
afterEach(cleanup);

describe('deskDraft', () => {
  it('starts in the composer with what the desk gives, and leaves out what is not one of Fleex\'s', () => {
    expect(deskDraft(desk, ['b1', 'b2'])).toMatchObject({ stage: 'compose', title: '', boardId: 'b2', type: 'fix', priority: 'high' });
    /* a board that is gone, a type or a priority that is not one */
    expect(deskDraft({ ...desk, defaults: { boardId: 'gone', type: 'nope', priority: 'huge' } }, ['b1'])).toMatchObject({ boardId: null, type: 'build', priority: 'none' });
    expect(deskDraft(null, ['b1'])).toMatchObject({ stage: 'compose', boardId: null, type: 'build' });
  });
});

describe('FactoryDeskForm', () => {
  it('creates the ticket with the desk\'s defaults, hands it over at the desk, and leaves the Work view\'s draft alone', async () => {
    const onClose = vi.fn();
    render(<FactoryDeskForm desk={desk} onClose={onClose} />);
    expect(screen.getByText(/born at Bug desk/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'The cart forgets its items' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ boardId: 'b2', title: 'The cart forgets its items', type: 'fix', priority: 'high' }));
    expect(transfer).toHaveBeenCalledWith('t-new', { machineId: 'd1' });
    /* nothing of the Work view moved: its draft is as it was, and it did not switch to the new ticket */
    expect(useWorkStore.getState().draft.title).toBe('Half written in the Work view');
    expect(useWorkStore.getState().selectedTicketId).not.toBe('t-new');
  });

  it('with no desk on the floor, the ticket lands in Inbound; Cancel closes without creating anything', async () => {
    const onClose = vi.fn();
    render(<FactoryDeskForm desk={null} onClose={onClose} />);
    expect(screen.getByText(/lands in Inbound/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(createTicket).not.toHaveBeenCalled();
    cleanup();
    render(<FactoryDeskForm desk={null} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Anything' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(transfer).toHaveBeenCalledWith('t-new', {}));
  });
});
