import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

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
});
