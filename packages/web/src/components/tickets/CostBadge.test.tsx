import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { CostBadge } from './CostBadge';

afterEach(cleanup);

describe('CostBadge', () => {
  it('renders nothing at $0 so backlog cards stay clean (#404)', () => {
    // WHY: the whole point of the sparse badge is that untouched tickets show no
    // "$0.00" noise. Absence of cost ⇒ absence of badge.
    const { container } = render(<CostBadge costUsd={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('formats the cost to exactly 2 decimals with a $ prefix', () => {
    const { container } = render(<CostBadge costUsd={3.47} />);
    expect(container.textContent).toBe('$3.47');
  });

  it('carries the cumulative cost in the tooltip', () => {
    const { container } = render(<CostBadge costUsd={12.8} />);
    expect(container.querySelector('[title="Coût cumulé agentique : $12.80"]')).not.toBeNull();
  });

  it('uses the theme-aware tint classes for the green/yellow/red tiers', () => {
    // WHY: decorative colour must go through the tint system (theme-aware). A
    // green-tier badge must reference the green tint var, not a raw palette class.
    const { container } = render(<CostBadge costUsd={4} />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('var(--tint-green-text)');
    // No inline colour for tint tiers.
    expect(span?.getAttribute('style')).toBeFalsy();
  });

  it('uses the near-black inline style for the top (> $50) tier', () => {
    // WHY: the tint system has no black hue, so the "beyond reasonable" tier
    // falls back to an inline dark-red fill — assert it actually applies it.
    const { container } = render(<CostBadge costUsd={85} />);
    const span = container.querySelector('span');
    const style = span?.getAttribute('style') ?? '';
    expect(style).toContain('background-color: rgb(69, 10, 10)'); // #450a0a
    expect(container.textContent).toBe('$85.00');
  });
});
