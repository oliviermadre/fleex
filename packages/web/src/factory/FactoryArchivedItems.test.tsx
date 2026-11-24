import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FactoryArchivedItemPopup, FactoryArchivedItems, filterArchived, howItLeft } from './FactoryArchivedItems';
import { useFactoryStore } from './factoryStore';
import type { ArchivedItem, MachineSpec } from './types';

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const item = (id: string, over: Partial<ArchivedItem> = {}): ArchivedItem => ({ itemId: id, source: 'gmail', title: `Mail ${id}`, author: 'Ana', url: 'https://mail.google.com/x', tags: [], intakeId: 'in', reason: 'junk', exitId: null, archivedAt: ago(1), createdAt: ago(5), messages: 1, lastActivityAt: ago(5), excerpt: 'hi', fields: {}, ...over });
const ITEMS = [item('a'), item('b', { reason: 'exit', exitId: 'out', author: 'Bob' }), item('c', { reason: 'exit' }), item('d', { reason: 'dropped' }), item('e', { intakeId: 'other' })];
const archivedItems = vi.fn(async () => ({ days: 7, since: ago(168), items: ITEMS }));
const getItem = vi.fn(async () => ({ id: 'b', source: 'gmail', title: 'Mail b', author: 'Bob', url: null, tags: ['finance'], excerpt: 'hi', messages: 1, lastActivityAt: ago(5), intakeId: 'in', machineId: 'out', archivedAt: ago(1), archivedReason: 'exit' }));
vi.mock('./factoryApi', () => ({ factoryApi: {
  archivedItems: (...a: unknown[]) => archivedItems(...(a as [])), item: (...a: unknown[]) => getItem(...(a as [])),
  itemRuns: async () => [], itemBody: async () => ({ text: 'the whole mail', html: null, kept: true }),
} }));

const machines: MachineSpec[] = [
  { id: 'in', kind: 'intake', x: 0, y: 0, w: 3, h: 2, name: 'Gmail', source: 'gmail' },
  { id: 'other', kind: 'intake', x: 0, y: 4, w: 3, h: 2, name: 'Support', source: 'gmail' },
  { id: 'out', kind: 'exit', x: 6, y: 0, w: 3, h: 3, name: 'Delivery Lane' },
] as MachineSpec[];
const seed = () => { const bringBack = vi.fn(async () => {}); useFactoryStore.setState({ statsDays: 7, layout: { version: 2, w: 0, h: 0, machines }, bringBack } as never); return bringBack; };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the archived items', () => {
  it('says how each left: by hand, by an exit (named when kept), dropped by a rule', () => {
    expect(howItLeft({ reason: 'junk', exitId: null }, machines)).toBe('by hand');
    expect(howItLeft({ reason: 'exit', exitId: 'out' }, machines)).toBe('Exit · Delivery Lane');
    expect(howItLeft({ reason: 'exit', exitId: 'gone' }, machines)).toBe('Exit · removed since');
    expect(howItLeft({ reason: 'exit', exitId: null }, machines)).toBe('by an exit');
    expect(howItLeft({ reason: 'dropped', exitId: null }, machines)).toBe('dropped by a rule');
  });

  it('filters by a title or sender, intake, how it left and source', () => {
    const ids = (f: Partial<Parameters<typeof filterArchived>[1]>) => filterArchived(ITEMS, { q: '', intakes: [], reasons: [], sources: [], ...f }).map((i) => i.itemId);
    expect(ids({ q: 'bob' })).toEqual(['b']);
    expect(ids({ intakes: ['other'] })).toEqual(['e']);
    expect(ids({ reasons: ['exit'] })).toEqual(['b', 'c']);
    expect(ids({ sources: ['slack'] })).toEqual([]);
  });

  it('from the floor: by hand and by an exit, the dropped hidden but counted; an item opens, or comes back', async () => {
    const bringBack = seed(), onOpenItem = vi.fn();
    render(<FactoryArchivedItems intakeId={null} onOpenItem={onOpenItem} onClose={vi.fn()} />);
    expect(await screen.findByText('Mail a')).toBeTruthy();
    expect(screen.queryByText('Mail d')).toBeNull();
    const region = screen.getByRole('region', { name: 'Archived items' });
    expect(region.textContent).toContain('1 dropped by a rule, hidden');
    expect(region.textContent).toContain('Exit · Delivery Lane');
    expect(region.textContent).toContain('by hand');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    expect(onOpenItem).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getAllByRole('button', { name: 'Bring back' })[0]!);
    await waitFor(() => expect(bringBack).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.queryByText('Mail a')).toBeNull());
  });

  it('from an intake: what it let in', async () => {
    seed();
    render(<FactoryArchivedItems intakeId="other" onOpenItem={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Mail e')).toBeTruthy();
    expect(screen.queryByText('Mail a')).toBeNull();
    expect(screen.getByRole('region', { name: 'Archived · Support' })).toBeTruthy();
  });

  it('an archived item opens read only, says how it left, and comes back from there', async () => {
    const bringBack = seed(), onClose = vi.fn();
    render(<FactoryArchivedItemPopup itemId="b" onClose={onClose} />);
    expect((await screen.findByLabelText('Its text')).textContent).toBe('the whole mail');
    expect(screen.queryByRole('textbox')).toBeNull();
    const popup = screen.getByRole('region', { name: 'Archived item' });
    expect(popup.textContent).toContain('Exit · Delivery Lane');
    expect(popup.textContent).toContain('finance');
    fireEvent.click(screen.getByRole('button', { name: 'Bring back' }));
    await waitFor(() => expect(bringBack).toHaveBeenCalledWith('b'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
