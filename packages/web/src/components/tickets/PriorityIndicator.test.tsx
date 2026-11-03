import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { TicketPriority } from '@fleex/shared';
import { PriorityIndicator, PRIORITY_ORDER_DESC, PRIORITY_LABELS } from './PriorityIndicator';

afterEach(cleanup);

const litBars = (container: HTMLElement) =>
  [...container.querySelectorAll('rect[data-lit]')].map((r) => r.getAttribute('data-lit') === 'true');

describe('PriorityIndicator', () => {
  // WHY: the level must be readable from the shape alone (colour is only a
  // second cue), so the number of lit bars is the contract.
  it.each([
    ['low', [true, false, false]],
    ['medium', [true, true, false]],
    ['high', [true, true, true]],
  ] as const)('%s lights the right number of the 3 bars', (priority, expected) => {
    const { container } = render(<PriorityIndicator priority={priority} />);
    expect(container.querySelector('[data-priority-icon="bars"]')).not.toBeNull();
    expect(litBars(container)).toEqual(expected);
  });

  it('urgent is its own shape (square with "!"), not a 4th bar', () => {
    const { container } = render(<PriorityIndicator priority="urgent" />);
    expect(container.querySelector('[data-priority-icon="urgent"]')).not.toBeNull();
    expect(container.querySelector('[data-priority-icon="bars"]')).toBeNull();
    expect(container.firstElementChild?.getAttribute('title')).toBe('Urgent');
  });

  it('none renders the dashes', () => {
    const { container } = render(<PriorityIndicator priority="none" />);
    expect(container.querySelector('[data-priority-icon="none"]')).not.toBeNull();
  });

  it('falls back to "none" for a value it does not know instead of crashing (priority is free text in storage)', () => {
    const { container } = render(<PriorityIndicator priority={'critical' as TicketPriority} />);
    expect(container.querySelector('[data-priority-icon="none"]')).not.toBeNull();
    expect(container.firstElementChild?.getAttribute('title')).toBe('No priority');
  });

  it('pickers list every level, most urgent first', () => {
    expect(PRIORITY_ORDER_DESC).toEqual(['urgent', 'high', 'medium', 'low', 'none']);
    expect(PRIORITY_ORDER_DESC.map((p) => PRIORITY_LABELS[p])).toEqual(['Urgent', 'High', 'Medium', 'Low', 'No priority']);
  });
});
