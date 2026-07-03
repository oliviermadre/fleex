import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';

function ticket(id: string, displayId: number, title: string): Ticket {
  return { id, displayId, title, boardId: 'b1' } as unknown as Ticket;
}

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [], selectedTicketId: null });
});

const noop = () => {};

// The generic renderer backs the ticket description, scratchpad and deliverables,
// so a chip here proves the mention works across those three surfaces.
describe('MarkdownRenderer — @ticket mentions', () => {
  it('renders a clickable ticket chip inside arbitrary markdown', () => {
    useTicketStore.setState({ tickets: [ticket('t1', 378, 'Mentionner des tickets')] });
    const { container, getByRole } = render(
      <MarkdownRenderer content="Blocked by @ticket:378 for now" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('#378');
    expect(container.textContent).toContain('Mentionner des tickets');

    fireEvent.click(getByRole('button'));
    expect(useTicketStore.getState().selectedTicketId).toBe('t1');
    expect(useUIStore.getState().activePanel).toBe('tickets');
  });

  it('leaves a ticket mention inside a code span untouched', () => {
    useTicketStore.setState({ tickets: [ticket('t1', 378, 'X')] });
    const { container } = render(
      <MarkdownRenderer content="use `@ticket:378` literally" onToggleCheckbox={noop} />,
    );
    // No chip: the literal text survives, the display id is not surfaced.
    expect(container.textContent).toContain('@ticket:378');
    expect(container.querySelector('button')).toBeNull();
  });

  it('degrades to plain text for an unknown ticket', () => {
    const { container } = render(
      <MarkdownRenderer content="see @ticket:999" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@ticket:999');
    expect(container.querySelector('button')).toBeNull();
  });
});
