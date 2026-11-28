/**
 * The Factory on the phone: its Tickets screen (what waits for you with its buttons, every ticket by machine), what a
 * ticket of the floor carries on its own screen, and the + that brings a ticket onto the floor. Every gesture waits out
 * its undo window before anything is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useToastStore } from '../../stores/toastStore';
import { useMobileNavStore } from '../../mobile/mobileNavStore';
import { useFactoryStore } from '../factoryStore';
import type { FactoryTicket } from '../types';
import { snapshotOf, tk } from './fixture';
import { forgetLastWords } from './MobileFactoryActs';
import { MobileFactoryFromFleex, MobileFactoryPlus } from './MobileFactoryPlus';
import { MobileFactoryAsk, MobileFactoryHandover, MobileFactoryWhere } from './MobileFactoryTicket';
import { MobileFactoryTickets } from './MobileFactoryTickets';
import { resetMobileFactory, UNDO_MS, useMobileFactoryStore } from './mobileFactoryStore';

const api = vi.hoisted(() => ({ fetchTicketComments: vi.fn(async (_id: string): Promise<unknown[]> => []), postTicketComment: vi.fn(async (_id: string, _body: string) => ({})) }));
vi.mock('../../services/api', async (orig) => ({ ...(await orig<typeof import('../../services/api')>()), ...api }));

function seed(tickets: FactoryTicket[]) {
  const acts = { resolve: vi.fn(async () => {}), putBack: vi.fn(async () => {}), release: vi.fn(async () => {}), setAside: vi.fn(async () => {}), giveBack: vi.fn(async () => {}), move: vi.fn(async () => {}), transfer: vi.fn(async () => {}) };
  useFactoryStore.setState({ enabled: true, managed: new Set(tickets.map((t) => t.ticketId)), snapshot: snapshotOf(tickets), loadManaged: async () => {}, refresh: async () => {}, ...acts });
  return acts;
}
const card = (n: number) => screen.getByRole('article', { name: new RegExp(`^#${n} `) });
const closeWindow = () => act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS); });

beforeEach(() => {
  vi.useFakeTimers(); resetMobileFactory();
  /* jsdom paints nothing: a ticket's token (a canvas) is left blank */
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  forgetLastWords(); useToastStore.setState({ toasts: [] }); api.fetchTicketComments.mockReset().mockResolvedValue([]); api.postTicketComment.mockReset().mockResolvedValue({});
});
afterEach(() => { cleanup(); resetMobileFactory(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Tickets › Needs you', () => {
  it('lists what waits for someone, longest wait first, and nothing the floor is dealing with', () => {
    seed([tk(1, 'build', 'running', 90), tk(2, 'gate', 'review', 40, { title: 'Stripe webhook' }), tk(3, 'tests', 'failed', 9, { note: 'exit 1' }), tk(4, 'qa', 'zone', 55), tk(5, 'inbound', 'zone', 99)]);
    render(<MobileFactoryTickets />);
    expect(screen.getByRole('tab', { name: 'Needs you 3' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['#4 Ticket 4', '#2 Stripe webhook', '#3 Ticket 3']);
    expect(card(2).textContent).toContain('PR Review · 40m');
    expect(card(3).textContent).toContain('exit 1');
  });

  it('decides a gate from its card: the ticket leaves the list at once, the decision is sent when the window closes', async () => {
    const acts = seed([tk(2, 'gate', 'review', 40)]);
    render(<MobileFactoryTickets />);
    expect(within(card(2)).getAllByRole('button').slice(1).map((b) => b.textContent)).toEqual(['approve', 'reject', 'fix-first']);
    fireEvent.click(within(card(2)).getByRole('button', { name: 'reject' }));
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText('Nothing waits for you')).toBeTruthy();
    expect(useToastStore.getState().toasts[0]!.message).toBe('#2 leaves PR Review as reject');
    expect(acts.resolve).not.toHaveBeenCalled();
    await closeWindow();
    expect(acts.resolve).toHaveBeenCalledWith('t2', 'reject', '');
  });

  it('takes a gesture back with Undo: the card is there again and nothing was sent', async () => {
    const acts = seed([tk(4, 'qa', 'zone', 55)]);
    render(<MobileFactoryTickets />);
    fireEvent.click(within(card(4)).getByRole('button', { name: 'Release' }));
    expect(screen.queryByRole('article')).toBeNull();
    act(() => useToastStore.getState().toasts[0]!.action!.onClick());
    expect(card(4)).toBeTruthy();
    await closeWindow();
    expect(acts.release).not.toHaveBeenCalled();
  });

  it('puts back a ticket set aside: another run, or out by an outcome of its station', async () => {
    const acts = seed([tk(6, 'build', 'aside', 12), tk(7, 'tests', 'failed', 3)]);
    render(<MobileFactoryTickets />);
    expect(within(card(6)).queryByRole('group', { name: 'Leave as' })).toBeNull();
    fireEvent.click(within(card(6)).getByRole('button', { name: 'Leave as…' }));
    fireEvent.click(within(within(card(6)).getByRole('group', { name: 'Leave as' })).getByRole('button', { name: 'blocked' }));
    fireEvent.click(within(card(7)).getByRole('button', { name: 'Run again' }));
    await closeWindow();
    expect(acts.putBack.mock.calls).toEqual([['t6', 'blocked'], ['t7']]);
  });

  it('answers an agent with one of the choices it declared, as a comment in the thread', async () => {
    api.fetchTicketComments.mockResolvedValue([
      { authorType: 'user', body: 'go' },
      { authorType: 'agent', body: 'Per API key or per IP?', questions: [{ prompt: 'Limit', options: ['Per API key', 'Per IP'] }] },
    ]);
    seed([tk(5, 'build', 'question', 31)]);
    render(<MobileFactoryTickets />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(card(5).textContent).toContain('Per API key or per IP?');
    fireEvent.click(within(card(5)).getByRole('button', { name: 'Per IP' }));
    await closeWindow();
    expect(api.postTicketComment).toHaveBeenCalledWith('t5', 'Per IP');
  });

  it('opens the ticket to answer in words, and takes in hand one that lies on the floor', () => {
    seed([tk(5, 'build', 'question', 31), tk(8, null, 'loose', 2)]);
    const openTicket = vi.fn();
    useMobileNavStore.setState({ openTicket });
    render(<MobileFactoryTickets />);
    fireEvent.click(within(card(5)).getByRole('button', { name: 'Answer' }));
    expect(openTicket).toHaveBeenCalledWith('t5', 'conversation');
    fireEvent.click(within(card(8)).getByRole('button', { name: 'Take' }));
    expect(useMobileFactoryStore.getState()).toMatchObject({ tab: 'map', hand: 't8' });
  });
});

describe('Tickets › All tickets', () => {
  it('lists every ticket by the machine it stands in, and narrows to what a search finds', () => {
    seed([tk(1, 'build', 'running', 5, { title: 'Slack intake' }), tk(2, 'gate', 'review', 40, { title: 'Stripe webhook' }), tk(3, 'inbound', 'zone', 2), tk(4, 'inbound', 'zone', 3)]);
    useMobileFactoryStore.setState({ list: 'all' });
    render(<MobileFactoryTickets />);
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Inbound', 'Build', 'PR Review']);
    expect(within(screen.getByRole('region', { name: 'PR Review' })).getByRole('button').textContent).toContain('decision');
    fireEvent.change(screen.getByLabelText('Find a ticket'), { target: { value: 'stripe' } });
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['PR Review']);
    fireEvent.change(screen.getByLabelText('Find a ticket'), { target: { value: 'nothing like it' } });
    expect(screen.getByText('No ticket matches')).toBeTruthy();
  });

  it('lets everything a zone holds out at once, as one gesture with one Undo', async () => {
    const acts = seed([tk(3, 'inbound', 'zone', 2), tk(4, 'inbound', 'zone', 3), tk(5, 'inbound', 'zone', 1, { released: true })]);
    useMobileFactoryStore.setState({ list: 'all' });
    render(<MobileFactoryTickets />);
    fireEvent.click(screen.getByRole('button', { name: 'Release all' }));
    expect(useToastStore.getState().toasts[0]!.message).toBe('2 released from Inbound');
    expect(screen.getByRole('button', { name: 'Undo release' })).toBeTruthy();
    await closeWindow();
    expect(acts.release.mock.calls).toEqual([['t3'], ['t4']]);
  });
});

describe('a ticket of the floor, on its own screen', () => {
  it('says where it stands under its title, and shows it on the map', () => {
    seed([tk(2, 'gate', 'review', 40)]);
    const selectTicket = vi.fn();
    useTicketStore.setState({ selectTicket });
    render(<MobileFactoryWhere ticketId="t2" />);
    const where = screen.getByRole('button');
    expect(where.textContent).toContain('PR Review');
    expect(where.textContent).toContain('Waiting for your decision · 40m');
    fireEvent.click(where);
    expect(useMobileFactoryStore.getState()).toMatchObject({ open: true, tab: 'map', goTo: 't2' });
    expect(selectTicket).toHaveBeenCalledWith(null);
  });

  it('asks a gate\'s decision at the foot of its conversation, with the reason given', async () => {
    const acts = seed([tk(2, 'gate', 'review', 40)]);
    render(<MobileFactoryAsk ticketId="t2" />);
    expect(screen.getByRole('alert').textContent).toContain('PR Review waits for your decision');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' dedupe on the endpoint too ' } });
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    expect(screen.getByRole('status').textContent).toContain('#2 leaves PR Review as approve, with your reason');
    await closeWindow();
    expect(acts.resolve).toHaveBeenCalledWith('t2', 'approve', 'dedupe on the endpoint too');
  });

  it('offers to set aside a ticket a station is working on, and says a question is answered in the composer', async () => {
    const acts = seed([tk(1, 'build', 'running', 4)]);
    const { unmount } = render(<MobileFactoryAsk ticketId="t1" />);
    expect(screen.getByRole('group', { name: 'Factory' }).textContent).toContain('Build is working on it');
    fireEvent.click(screen.getByRole('button', { name: 'Set aside' }));
    await closeWindow();
    expect(acts.setAside).toHaveBeenCalledWith('t1');
    unmount();
    seed([tk(5, 'build', 'question', 31)]);
    render(<MobileFactoryAsk ticketId="t5" />);
    expect(screen.getByRole('alert').textContent).toContain('Reply below');
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  });

  it('is not there for a ticket the floor asks nothing about, nor for one that is not on it', () => {
    seed([tk(3, 'inbound', 'zone', 2, { released: true })]);
    const { container, rerender } = render(<MobileFactoryAsk ticketId="t3" />);
    expect(container.textContent).toBe('');
    rerender(<MobileFactoryAsk ticketId="elsewhere" />);
    expect(container.textContent).toBe('');
    rerender(<MobileFactoryWhere ticketId="elsewhere" />);
    expect(container.textContent).toBe('');
  });

  it('hands a ticket over from its context, or takes it back, and is not there while the Factory is off', async () => {
    const acts = seed([tk(2, 'gate', 'review', 40)]);
    const { rerender, container } = render(<MobileFactoryHandover ticketId="t2" displayId={2} status="doing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Take back from Factory' }));
    expect(screen.getByRole('status').textContent).toContain('#2 taken back');
    await closeWindow();
    expect(acts.giveBack).toHaveBeenCalledWith('t2');
    rerender(<MobileFactoryHandover ticketId="other" displayId={9} status="todo" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to Factory' })); await vi.advanceTimersByTimeAsync(0); });
    expect(acts.transfer).toHaveBeenCalledWith('other', {});
    rerender(<MobileFactoryHandover ticketId="closed" displayId={10} status="done" />);
    expect((screen.getByRole('button', { name: 'Send to Factory' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => useFactoryStore.setState({ enabled: false }));
    expect(container.textContent).toBe('');
  });
});

describe('the + of the Factory', () => {
  it('offers a new ticket at each desk of the floor, or in Inbound when there is none, and the tickets of Fleex', async () => {
    seed([]);
    const onPick = vi.fn();
    const { unmount } = render(<MobileFactoryPlus onClose={() => {}} onPick={onPick} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    fireEvent.click(screen.getByRole('button', { name: /^New ticket/ }));
    expect(onPick).toHaveBeenLastCalledWith({ new: expect.objectContaining({ id: 'desk' }) });
    fireEvent.click(screen.getByRole('button', { name: /^From Fleex/ }));
    expect(onPick).toHaveBeenLastCalledWith('fleex');
    unmount();
    useFactoryStore.setState({ snapshot: snapshotOf([], []) });
    render(<MobileFactoryPlus onClose={() => {}} onPick={onPick} />);
    expect(screen.getByRole('button', { name: /^New ticket/ }).textContent).toContain('lands in Inbound');
  });

  it('lists the open tickets Fleex drives, and sends one to the Factory', async () => {
    const acts = seed([tk(2, 'gate', 'review', 40)]);
    const fleex = (n: number, title: string, over: Partial<Ticket> = {}) => ({ id: `t${n}`, displayId: n, title, status: 'todo', archivedAt: null, ...over }) as unknown as Ticket;
    useTicketStore.setState({ tickets: [fleex(2, 'Already on the floor'), fleex(388, 'Onboarding: skip the board step'), fleex(391, 'Reader loses its scroll'), fleex(394, 'Shipped long ago', { status: 'done' })], fetchTickets: async () => {} });
    render(<MobileFactoryFromFleex onClose={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Send' })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Find a ticket of Fleex'), { target: { value: '#391' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(acts.transfer).toHaveBeenCalledWith('t391', {});
  });
});
