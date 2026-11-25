import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { FactoryCardToggle } from './FactoryCardToggle';
import { useFactoryStore } from './factoryStore';

afterEach(cleanup);
const set = (enabled: boolean, ids: string[]) => {
  const transfer = vi.fn(async () => {}), giveBack = vi.fn(async () => {}), loadManaged = vi.fn(async () => {});
  useFactoryStore.setState({ enabled, managed: new Set(ids), transfer, giveBack, loadManaged } as never);
  return { transfer, giveBack, loadManaged };
};

describe('the Factory toggle on a Kanban card', () => {
  it('sends a ticket plain Fleex drives to the Factory, and gives back one it drives', async () => {
    const a = set(true, []);
    render(<FactoryCardToggle ticketId="t1" closed={false} />);
    const b = screen.getByRole('button', { name: 'Send to the Factory' });
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.getAttribute('title')).toMatch(/^Send to the Factory/);
    await act(async () => { fireEvent.click(b); });
    expect(a.transfer).toHaveBeenCalledWith('t1', {});
    expect(a.loadManaged).toHaveBeenCalled();
    cleanup();
    const c = set(true, ['t1']);
    render(<FactoryCardToggle ticketId="t1" closed={false} />);
    expect(screen.getByRole('button', { name: 'Give back from the Factory' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(c.giveBack).toHaveBeenCalledWith('t1');
  });

  it('is not there while the Factory is off, nor on a done ticket it does not drive', () => {
    set(false, []);
    const { container, rerender } = render(<FactoryCardToggle ticketId="t1" closed={false} />);
    expect(container.innerHTML).toBe('');
    set(true, []);
    rerender(<FactoryCardToggle ticketId="t1" closed />);
    expect(container.innerHTML).toBe('');
    set(true, ['t1']);
    rerender(<FactoryCardToggle ticketId="t1" closed />);
    expect(screen.getByRole('button')).toBeTruthy();                           // driven by the Factory: it can still be given back
  });
});
