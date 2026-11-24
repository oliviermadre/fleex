import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FactoryTicketsModal } from './FactoryTicketsModal';
import { showsKind } from './KindChoice';
import { useFactoryStore } from './factoryStore';
import { NO_FINDER } from './finder';
import type { FactoryTicket } from './types';

const t = (id: string, title: string, item = false): FactoryTicket => ({
  ticketId: id, machineId: null, x: 0, y: 0, phase: 'loose', p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '2026-11-15T09:00:00.000Z', runId: null, note: '', handedAt: '',
  info: { id, displayId: item ? 0 : 7, title, type: item ? 'src:gmail' : 'build', priority: 'medium', status: 'todo', tags: [], boardId: 'b1', complexity: null, favorite: false, blocked: false },
  ...(item ? { item: { source: 'gmail', author: 'Ana', excerpt: '', url: null, messages: 1, lastActivityAt: '2026-11-15T09:00:00.000Z', fields: {} } } : {}),
} as FactoryTicket);

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); });

describe('tickets, items or both', () => {
  it('lets a line through as asked', () => {
    expect([showsKind('tickets', false), showsKind('tickets', true), showsKind('items', true), showsKind('items', false), showsKind('both', true)]).toEqual([true, false, true, false, true]);
  });

  it('the ticket list (Tab) opens on the tickets, switches to the items or both, and keeps the choice', () => {
    useFactoryStore.setState({ snapshot: { tickets: [t('a', 'Fix the cart'), t('i', 'Re: invoice', true)], serverTime: '2026-11-15T10:00:00.000Z' }, layout: { version: 2, w: 0, h: 0, machines: [] } } as never);
    const props = { finder: NO_FINDER, onFinder: vi.fn(), onGoTo: vi.fn(), onDetail: vi.fn(), onClose: vi.fn() };
    render(<FactoryTicketsModal {...props} />);
    expect(screen.getByText('Fix the cart')).toBeTruthy();
    expect(screen.queryByText('Re: invoice')).toBeNull();
    expect(screen.getByRole('radio', { name: /Tickets/ }).textContent).toContain('1');
    fireEvent.click(screen.getByRole('radio', { name: /Items/ }));
    expect(screen.queryByText('Fix the cart')).toBeNull();
    expect(screen.getByText('Re: invoice')).toBeTruthy();
    cleanup();
    render(<FactoryTicketsModal {...props} />);
    expect(screen.getByRole('radio', { name: /Items/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Both/ }));
    expect(screen.getByText('Fix the cart')).toBeTruthy();
    expect(screen.getByText('Re: invoice')).toBeTruthy();
  });
});
