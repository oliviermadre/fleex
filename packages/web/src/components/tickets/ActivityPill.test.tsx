import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ActivityPill } from './ActivityPill';

afterEach(cleanup);

describe('ActivityPill', () => {
  it('renders nothing when idle (no pill on inactive tickets — spec AC4)', () => {
    const { container } = render(<ActivityPill activity="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a readable "Running" label, not color alone (spec AC1, AC9)', () => {
    // WHY: AC9 forbids conveying state by color only. The text must be present so
    // screen readers and color-blind users perceive the state.
    const { container } = render(<ActivityPill activity="running" />);
    expect(container.textContent).toContain('Running');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('shows a readable "Waiting" label (spec AC2, AC9)', () => {
    const { container } = render(<ActivityPill activity="waiting" />);
    expect(container.textContent).toContain('Waiting');
  });

  it('uses the provided detail as the tooltip, else a per-state default (spec AC8)', () => {
    const withDetail = render(<ActivityPill activity="waiting" detail="Answer needed on scope" />);
    expect(withDetail.container.querySelector('[title="Answer needed on scope"]')).not.toBeNull();
    cleanup();
    const withoutDetail = render(<ActivityPill activity="running" />);
    const el = withoutDetail.container.querySelector('[role="status"]');
    expect(el?.getAttribute('title')).toBeTruthy();
  });

  it('stays an inert pill — not a button — when there is nothing to open', () => {
    // WHY: the hover/press affordance must only appear where a click leads
    // somewhere. No running execution ⇒ no button, no cursor-pointer.
    const { container } = render(<ActivityPill activity="running" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('becomes a button that opens the execution, without triggering its host', () => {
    // WHY: every host of the pill (kanban card, cockpit row) is itself clickable;
    // opening the stream must not also open the ticket behind it.
    const onClick = vi.fn();
    const onHostClick = vi.fn();
    const { container } = render(
      <div onClick={onHostClick}>
        <ActivityPill activity="running" duration="5m" onClick={onClick} />
      </div>,
    );
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('Running for 5m');
    // Still announced as a live state, and the press affordance is on the pill.
    expect(button?.querySelector('[role="status"]')).not.toBeNull();
    expect(button?.className).toContain('active:translate-y-px');

    fireEvent.click(button!);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onHostClick).not.toHaveBeenCalled();
  });
});
