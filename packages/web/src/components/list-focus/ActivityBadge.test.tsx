import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ActivityBadge } from './ActivityBadge';

/**
 * Cockpit activity column badge (#400, pass 4, remarks 3–5). NaS replaced the
 * virtual "En attente" grouping with a per-row badge column: "waiting"
 * (yellow), "running" (blue), "idle since {{time}}" (gray) — and when a ticket
 * never had an SDK session, just "idle".
 */

const NOW = new Date('2026-07-17T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ActivityBadge', () => {
  it('renders the yellow Waiting pill when waiting (same pill as the kanban card)', () => {
    const { container } = render(<ActivityBadge activity="waiting" detail="mention en attente" />);
    expect(container.textContent).toContain('Waiting');
    expect(container.innerHTML).toContain('tint-yellow'); // yellow per remark 5
    expect(container.querySelector('[title="mention en attente"]')).not.toBeNull();
  });

  it('renders the blue Running pill when an SDK session is running (remark 4)', () => {
    const { container } = render(<ActivityBadge activity="running" />);
    expect(container.textContent).toContain('Running');
    expect(container.innerHTML).toContain('tint-blue'); // blue per remark 5
  });

  it('shows gray "idle since {{age}}" from the last SDK activity (remark 5)', () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString();
    const { container } = render(<ActivityBadge activity="idle" lastActivityAt={twoHoursAgo} />);
    expect(container.textContent).toBe('idle since 2h');
    expect(container.innerHTML).toContain('gray'); // gray per remark 5
  });

  it('shows just "idle" when the ticket never had an SDK session (remark 5)', () => {
    const { container } = render(<ActivityBadge activity="idle" lastActivityAt={null} />);
    expect(container.textContent).toBe('idle');
  });
});
