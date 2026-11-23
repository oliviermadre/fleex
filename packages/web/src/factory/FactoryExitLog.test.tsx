import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { exitRows, FactoryExitLog, shippedWhen } from './FactoryExitLog';
import { useFactoryStore } from './factoryStore';
import type { ExitLog } from './types';

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const LOG: ExitLog = {
  machineId: 'out', days: 7, since: ago(168),
  tickets: [
    { ticketId: 't1', displayId: 812, title: 'Retry on 502', type: 'fix', priority: 'high', boardId: 'b1', status: 'done', archived: false, tags: [], handedAt: ago(30), shippedAt: ago(2) },
    { ticketId: 't2', displayId: 799, title: 'Split payment', type: 'build', priority: 'medium', boardId: 'b1', status: 'doing', archived: false, tags: ['team:shop'], handedAt: ago(60), shippedAt: ago(50) },
    { ticketId: 't3', displayId: null, title: 'A ticket deleted since', type: '', priority: '', boardId: null, status: null, archived: false, tags: [], handedAt: ago(80), shippedAt: ago(70) },
  ],
  items: [{ itemId: 'i1', source: 'gmail', title: 'Re: invoice', author: 'Ana', url: 'https://mail.google.com/x', tags: [], handedAt: ago(6), shippedAt: ago(5) }],
};
const exitLog = vi.fn(async () => LOG);
vi.mock('./factoryApi', () => ({ factoryApi: { exitLog: (...a: unknown[]) => exitLog(...(a as [])) } }));

afterEach(() => { cleanup(); });

describe('what left by an exit', () => {
  it('puts tickets and items in one list, the latest out first, and says what each is now', () => {
    const rows = exitRows(LOG);
    expect(rows.map((r) => r.info.title)).toEqual(['Retry on 502', 'Re: invoice', 'Split payment', 'A ticket deleted since']);
    expect(rows.map((r) => r.now)).toEqual(['done', 'archived', 'reopened · doing', 'deleted since']);
    expect(rows.map((r) => r.reopened)).toEqual([false, false, true, false]);
    expect(rows[0]!.lead).toBeCloseTo(28 * 3_600_000, -4);
    expect(rows[1]).toMatchObject({ ticketId: null, source: 'Gmail', url: 'https://mail.google.com/x' });
    expect(rows[3]!.ticketId).toBeNull();                                // nothing to open
  });

  it('says when it left: today, yesterday, a weekday, then a date', () => {
    const now = new Date(2026, 10, 23, 15, 0);
    expect(shippedWhen(new Date(2026, 10, 23, 11, 42).toISOString(), now)).toBe('today 11:42');
    expect(shippedWhen(new Date(2026, 10, 22, 17, 20).toISOString(), now)).toBe('yesterday 17:20');
    expect(shippedWhen(new Date(2026, 10, 20, 9, 5).toISOString(), now)).toMatch(/^Fri 09:05$/);
    expect(shippedWhen(new Date(2026, 10, 2, 9, 5).toISOString(), now)).toBe('2 Nov');
  });

  it('opens on the stats period, with its figures, a ticket to open, and the settings a button away', async () => {
    useFactoryStore.setState({ statsDays: 7, layout: { version: 2, w: 0, h: 0, machines: [{ id: 'out', kind: 'exit', x: 0, y: 0, w: 3, h: 3, name: 'Done' }] } } as never);
    const on = { onClose: vi.fn(), onSettings: vi.fn(), onOpenTicket: vi.fn() };
    render(<FactoryExitLog machineId="out" {...on} />);
    expect(await screen.findByText('Retry on 502')).toBeTruthy();
    expect(exitLog).toHaveBeenCalledWith('out', 7);
    const region = screen.getByRole('region', { name: 'What left by Done' });
    expect(region.textContent).toContain('Last 7 days');
    expect(region.textContent).toContain('3tickets shipped');
    expect(region.textContent).toContain('reopened since');
    fireEvent.click(screen.getAllByRole('button', { name: 'Detail' })[0]!);
    expect(on.onOpenTicket).toHaveBeenCalledWith('t1');
    fireEvent.change(screen.getByLabelText('Find by title or number'), { target: { value: '#799' } });
    expect(screen.queryByText('Retry on 502')).toBeNull();
    expect(screen.getByText('Split payment')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(on.onSettings).toHaveBeenCalled();
  });
});
