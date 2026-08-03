import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import type { Ticket } from '@fleex/shared';

import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';

import { MarkdownRenderer } from './MarkdownRenderer';

function ticket(id: string, displayId: number, title: string): Ticket {
  return { id, displayId, title, boardId: 'b1' } as unknown as Ticket;
}

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [], selectedTicketId: null });
});

const noop = () => {};

/**
 * The markdown pipeline sits behind a lazy boundary, so every assertion has to
 * wait for the real markup. Selecting on an element the pipeline produces (and
 * the plain-text fallback does not) is what keeps these tests honest: asserting
 * on textContent alone would pass against the fallback and could never fail.
 */
async function findRendered(container: HTMLElement, selector: string) {
  return waitFor(() => {
    const el = container.querySelector(selector);
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

// The generic renderer backs the ticket description, scratchpad and deliverables,
// so a chip here proves the mention works across those three surfaces.
describe('MarkdownRenderer — @ticket mentions', () => {
  it('renders a clickable ticket chip inside arbitrary markdown', async () => {
    useTicketStore.setState({ tickets: [ticket('t1', 378, 'Mentionner des tickets')] });
    const { container } = render(
      <MarkdownRenderer content="Blocked by @ticket:378 for now" onToggleCheckbox={noop} />,
    );
    const chip = await screen.findByRole('button');
    expect(container.textContent).toContain('#378');
    expect(container.textContent).toContain('Mentionner des tickets');

    fireEvent.click(chip);
    expect(useTicketStore.getState().selectedTicketId).toBe('t1');
    expect(useUIStore.getState().activePanel).toBe('tickets');
  });

  it('leaves a ticket mention inside a code span untouched', async () => {
    useTicketStore.setState({ tickets: [ticket('t1', 378, 'X')] });
    const { container } = render(
      <MarkdownRenderer content="use `@ticket:378` literally" onToggleCheckbox={noop} />,
    );
    // No chip: the literal text survives inside the code span, unexpanded.
    const code = await findRendered(container, 'code');
    expect(code.textContent).toContain('@ticket:378');
    expect(container.querySelector('button')).toBeNull();
  });

  it('degrades to plain text for an unknown ticket', async () => {
    const { container } = render(
      <MarkdownRenderer content="see @ticket:999" onToggleCheckbox={noop} />,
    );
    const paragraph = await findRendered(container, 'p');
    expect(paragraph.textContent).toContain('@ticket:999');
    expect(container.querySelector('button')).toBeNull();
  });
});
