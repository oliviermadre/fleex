import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { ActivityBadge } from './ActivityBadge';

/**
 * Cockpit activity column badge (#400). Pass 5 (NaS):
 * - EVERY badge carries its duration — "Waiting for 2h", "Running for 5m",
 *   "idle for 3h" — knowing how long a state has lasted matters for all three;
 * - the wording is "for", not "since" ("idle since 5s" was an English mistake);
 * - the age ticks live every second, with smart unit rollover (59s → 1m, never
 *   61s), without any page refresh.
 * Pass 6 (NaS): a badge on two lines is FORBIDDEN ("Waiting for 11h" was
 * wrapping inside the pill), and idle must sit inside a gray-tinted pill just
 * like Waiting/Running — not as bare text.
 */

const NOW = new Date('2026-07-17T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ActivityBadge', () => {
  it('shows the duration on the yellow Waiting pill ("Waiting for {{age}}")', () => {
    const { container } = render(
      <ActivityBadge activity="waiting" detail="mention en attente" since={ago(2 * HOUR)} />,
    );
    expect(container.textContent).toContain('Waiting for 2h');
    expect(container.innerHTML).toContain('tint-yellow');
    expect(container.querySelector('[title="mention en attente"]')).not.toBeNull();
  });

  it('shows the duration on the blue Running pill ("Running for {{age}}")', () => {
    const { container } = render(<ActivityBadge activity="running" since={ago(5 * MIN)} />);
    expect(container.textContent).toContain('Running for 5m');
    expect(container.innerHTML).toContain('tint-blue');
  });

  it('falls back to the plain pill label when the state start is unknown', () => {
    const { container } = render(<ActivityBadge activity="running" />);
    expect(container.textContent).toBe('Running');
  });

  it('says "idle for {{age}}" — "for", not "since" (pass 5 wording fix)', () => {
    const { container } = render(<ActivityBadge activity="idle" lastActivityAt={ago(2 * HOUR)} />);
    expect(container.textContent).toBe('idle for 2h');
    expect(container.innerHTML).toContain('gray');
  });

  it('shows just "idle" when the ticket never had an SDK session', () => {
    const { container } = render(<ActivityBadge activity="idle" lastActivityAt={null} />);
    expect(container.textContent).toBe('idle');
  });

  it('ticks the idle age every second without any refresh', () => {
    // WHY: NaS watched "idle since 0s" stay frozen until a page reload. The
    // whole point of the duration is to be alive.
    const { container } = render(<ActivityBadge activity="idle" lastActivityAt={ago(5 * SEC)} />);
    expect(container.textContent).toBe('idle for 5s');
    act(() => vi.advanceTimersByTime(1 * SEC));
    expect(container.textContent).toBe('idle for 6s');
    act(() => vi.advanceTimersByTime(1 * SEC));
    expect(container.textContent).toBe('idle for 7s');
  });

  it('rolls the unit over live: 59s ticks into 1m, never 60s+ (pass 5)', () => {
    const { container } = render(<ActivityBadge activity="idle" lastActivityAt={ago(59 * SEC)} />);
    expect(container.textContent).toBe('idle for 59s');
    act(() => vi.advanceTimersByTime(2 * SEC));
    expect(container.textContent).toBe('idle for 1m');
  });

  it('ticks the pill durations too (waiting/running are just as alive)', () => {
    const { container } = render(<ActivityBadge activity="waiting" since={ago(58 * SEC)} />);
    expect(container.textContent).toContain('Waiting for 58s');
    act(() => vi.advanceTimersByTime(3 * SEC));
    expect(container.textContent).toContain('Waiting for 1m');
  });

  it('renders idle inside a gray-tinted pill, like Waiting/Running (pass 6)', () => {
    // WHY: NaS — "comme pour running et waiting, j'aurai aimé que le idle
    // soit à l'intérieur d'un badge (teinte grise)". Bare gray text read as
    // unfinished next to the tinted pills.
    const { container } = render(<ActivityBadge activity="idle" lastActivityAt={ago(2 * HOUR)} />);
    const pill = container.querySelector('.rounded-full');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('idle for 2h');
    expect(pill?.className).toContain('tint-gray');
  });

  it('never lets any badge wrap onto two lines (pass 6: "interdit !")', () => {
    // WHY: "Waiting for 11h" was wrapping inside the pill — the duration made
    // the label outgrow the activity column and the pill had no nowrap.
    const waiting = render(<ActivityBadge activity="waiting" since={ago(11 * HOUR)} />);
    expect(waiting.container.querySelector('[role="status"]')?.className).toContain(
      'whitespace-nowrap',
    );
    const idle = render(<ActivityBadge activity="idle" lastActivityAt={ago(11 * HOUR)} />);
    expect(idle.container.querySelector('.rounded-full')?.className).toContain(
      'whitespace-nowrap',
    );
  });
});
