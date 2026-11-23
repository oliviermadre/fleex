import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { exitRows, FactoryExitLog, filterExitRows, NO_EXIT_FILTER, perDay, shippedWhen } from './FactoryExitLog';
import { useFactoryStore } from './factoryStore';
import type { ExitLog } from './types';

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const LOG: ExitLog = {
  machineId: null, days: 7, since: ago(168),
  exits: [{ machineId: 'out', name: 'Delivery', onFloor: true }, { machineId: 'old', name: 'Old exit', onFloor: false }],
  tickets: [
    { machineId: 'out', ticketId: 't1', displayId: 812, title: 'Retry on 502', type: 'fix', priority: 'high', boardId: 'b1', status: 'done', archived: false, tags: [], handedAt: ago(30), shippedAt: ago(2) },
    { machineId: 'old', ticketId: 't2', displayId: 799, title: 'Split payment', type: 'build', priority: 'medium', boardId: 'b2', status: 'doing', archived: false, tags: ['team:shop'], handedAt: ago(60), shippedAt: ago(50) },
    { machineId: 'out', ticketId: 't3', displayId: null, title: 'A ticket deleted since', type: '', priority: '', boardId: null, status: null, archived: false, tags: [], handedAt: ago(80), shippedAt: ago(70) },
  ],
  items: [{ machineId: 'out', itemId: 'i1', source: 'gmail', title: 'Re: invoice', author: 'Ana', url: 'https://mail.google.com/x', tags: [], handedAt: ago(6), shippedAt: ago(5) }],
};
const exitLog = vi.fn(async () => LOG);
vi.mock('./factoryApi', () => ({ factoryApi: { exitLog: (...a: unknown[]) => exitLog(...(a as [])) } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('what left by the exits', () => {
  it('puts tickets and items in one list, the latest out first, and says what each is now', () => {
    const rows = exitRows(LOG);
    expect(rows.map((r) => r.info.title)).toEqual(['Retry on 502', 'Re: invoice', 'Split payment', 'A ticket deleted since']);
    expect(rows.map((r) => r.now)).toEqual(['done', 'archived', 'reopened · doing', 'deleted since']);
    expect(rows.map((r) => r.state)).toEqual(['done', 'archived', 'reopened', 'deleted']);
    expect(rows[0]!.lead).toBeCloseTo(28 * 3_600_000, -4);
    expect(rows[1]).toMatchObject({ ticketId: null, source: 'Gmail', url: 'https://mail.google.com/x', machineId: 'out' });
    expect(rows[3]!.ticketId).toBeNull();                                // nothing to open
  });

  it('filters as the ticket list does: by exit, board, type, priority, what it is now, and a title, number or tag', () => {
    const rows = exitRows(LOG), titles = (f: Partial<typeof NO_EXIT_FILTER>) => filterExitRows(rows, { ...NO_EXIT_FILTER, ...f }).map((r) => r.info.title);
    expect(titles({ exits: ['old'] })).toEqual(['Split payment']);
    expect(titles({ boards: ['b1'] })).toEqual(['Retry on 502']);                    // an item has no board
    expect(titles({ types: ['fix', 'src:gmail'] })).toEqual(['Retry on 502', 'Re: invoice']);
    expect(titles({ priorities: ['medium'] })).toEqual(['Split payment']);
    expect(titles({ states: ['reopened', 'deleted'] })).toEqual(['Split payment', 'A ticket deleted since']);
    expect(titles({ q: '#79' })).toEqual(['Split payment']);
    expect(titles({ q: 'shop' })).toEqual(['Split payment']);                       // a tag
  });

  it('counts what left day by day, today last', () => {
    const now = new Date(2026, 10, 23, 15, 0), row = (d: Date) => ({ shippedAt: d.toISOString() }) as never;
    const days = perDay([row(new Date(2026, 10, 23, 9)), row(new Date(2026, 10, 23, 1)), row(new Date(2026, 10, 21, 22)), row(new Date(2026, 10, 10))], 3, now);
    expect(days.map((d) => [d.day.getDate(), d.n])).toEqual([[21, 1], [22, 0], [23, 2]]);
  });

  it('says when it left: today, yesterday, a weekday, then a date', () => {
    const now = new Date(2026, 10, 23, 15, 0);
    expect(shippedWhen(new Date(2026, 10, 23, 11, 42).toISOString(), now)).toBe('today 11:42');
    expect(shippedWhen(new Date(2026, 10, 22, 17, 20).toISOString(), now)).toBe('yesterday 17:20');
    expect(shippedWhen(new Date(2026, 10, 20, 9, 5).toISOString(), now)).toBe('Fri 09:05');
    expect(shippedWhen(new Date(2026, 10, 2, 9, 5).toISOString(), now)).toBe('2 Nov');
  });

  it('one exit: its figures and throughput, a ticket to open, and its settings a button away', async () => {
    exitLog.mockResolvedValueOnce({ ...LOG, machineId: 'out', exits: [LOG.exits[0]!], tickets: LOG.tickets.filter((t) => t.machineId === 'out'), items: LOG.items });
    useFactoryStore.setState({ statsDays: 7 } as never);
    const on = { onClose: vi.fn(), onSettings: vi.fn(), onOpenTicket: vi.fn() };
    render(<FactoryExitLog machineId="out" {...on} />);
    expect(await screen.findByText('Retry on 502')).toBeTruthy();
    expect(exitLog).toHaveBeenCalledWith('out', 7);
    const region = screen.getByRole('region', { name: 'What left by Delivery' });
    expect(region.textContent).toContain('Last 7 days');
    expect(region.textContent).toContain('2tickets shipped');
    expect(region.textContent).toContain('0.3 / daythroughput');
    expect(screen.getByRole('img', { name: 'Tickets shipped per day' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Exits/ })).toBeNull();               // one exit: nothing to pick
    fireEvent.click(screen.getAllByRole('button', { name: 'Detail' })[0]!);
    expect(on.onOpenTicket).toHaveBeenCalledWith('t1');
    fireEvent.change(screen.getByLabelText('Find by title, number or tag'), { target: { value: 'invoice' } });
    expect(screen.queryByText('Retry on 502')).toBeNull();
    expect(region.textContent).toContain('1 of 3 shown');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(on.onSettings).toHaveBeenCalled();
  });

  it('every exit: grouped by exit, one removed since named as it was, and no settings', async () => {
    useFactoryStore.setState({ statsDays: 7 } as never);
    render(<FactoryExitLog machineId={null} onClose={vi.fn()} onOpenTicket={vi.fn()} />);
    expect(await screen.findByText('Retry on 502')).toBeTruthy();
    expect(exitLog).toHaveBeenCalledWith(null, 7);
    const delivery = screen.getByRole('rowgroup', { name: 'Delivery' }), old = screen.getByRole('rowgroup', { name: 'Old exit' });
    expect(within(delivery).queryByText('Split payment')).toBeNull();
    expect(within(old).getByText('Split payment')).toBeTruthy();
    expect(old.textContent).toContain('no longer on the floor');
    expect(screen.getByRole('region', { name: 'What left by the exits' }).textContent).toContain('what left by the 2 exits');
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });
});
