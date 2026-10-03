import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Ticket, TicketLink } from '@fleex/shared';

vi.mock('../services/api', () => ({ fetchPRCiSummaries: vi.fn().mockResolvedValue({}) }));

import { MobileTicketCard } from './MobileTicketCard';
import { resetPrCiStore } from '../stores/prCiStore';

function ticket(prCount: number): Ticket {
  const links = Array.from({ length: prCount }, (_, i) => ({
    id: `l${i}`, type: 'github_pr', ref: `acme/app#${i + 1}`, label: `PR #${i + 1}`, url: null,
  })) as TicketLink[];
  return { id: 't1', displayId: 7, title: 'Do it', priority: 'none', tags: [], links } as unknown as Ticket;
}

afterEach(() => {
  cleanup();
  resetPrCiStore();
});

describe('MobileTicketCard PR chips', () => {
  it('shows no chip without PR', () => {
    render(<MobileTicketCard ticket={ticket(0)} onOpen={vi.fn()} />);
    expect(screen.queryByText(/app#/)).toBeNull();
  });

  it('shows each PR up to two, then one summary chip', () => {
    const { rerender } = render(<MobileTicketCard ticket={ticket(2)} onOpen={vi.fn()} />);
    expect(screen.getByText('app#1')).toBeTruthy();
    expect(screen.getByText('app#2')).toBeTruthy();
    rerender(<MobileTicketCard ticket={ticket(6)} onOpen={vi.fn()} />);
    expect(screen.queryByText('app#1')).toBeNull();
    expect(screen.getByRole('button', { name: /^6 PR/ })).toBeTruthy();
  });

  it('tapping a chip does not open the ticket; the card still opens by tap and keyboard', () => {
    const onOpen = vi.fn();
    render(<MobileTicketCard ticket={ticket(6)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /^6 PR/ }));
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Do it'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: /Do it/ }), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
