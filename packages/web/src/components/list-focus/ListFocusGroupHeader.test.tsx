import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { ListFocusGroupHeader } from './ListFocusGroupHeader';

afterEach(cleanup);

/**
 * Cockpit group band (#400, pass 8): NaS asked to remove the standalone status
 * "pill" and colour the WHOLE band with the status background, the label in
 * UPPERCASE using the contrasting bi-tone text colour — theme-aware (the tint
 * CSS vars flip with light/dark), so band-bg and label-text stay a legible pair.
 */
describe('ListFocusGroupHeader', () => {
  it('colours the whole band with the status tint and shows the label uppercase (pass 8)', () => {
    const { getByRole, getByText } = render(
      <ListFocusGroupHeader
        groupKey="doing"
        label="Doing"
        count={4}
        collapsed={false}
        onToggle={() => {}}
      />,
    );
    const band = getByRole('button');
    // doing → blue tint: the band itself carries BOTH the tinted background and
    // the bi-tone label text colour (theme-aware var refs).
    expect(band.className).toContain('bg-[var(--tint-blue-bg)]');
    expect(band.className).toContain('text-[var(--tint-blue-text)]');
    const label = getByText('Doing');
    expect(label.className).toContain('uppercase');
    // the label is no longer a standalone chip — no rounded pill background.
    expect(label.className).not.toContain('rounded');
  });

  it('uses each status own hue (reviewing → purple) (pass 8)', () => {
    const { getByRole } = render(
      <ListFocusGroupHeader
        groupKey="reviewing"
        label="Reviewing"
        count={2}
        collapsed={false}
        onToggle={() => {}}
      />,
    );
    expect(getByRole('button').className).toContain('bg-[var(--tint-purple-bg)]');
    expect(getByRole('button').className).toContain('text-[var(--tint-purple-text)]');
  });

  it('toggles collapse on click and rotates the chevron only when expanded (pass 8)', () => {
    const onToggle = vi.fn();
    const { getByRole, rerender } = render(
      <ListFocusGroupHeader
        groupKey="doing"
        label="Doing"
        count={1}
        collapsed={false}
        onToggle={onToggle}
      />,
    );
    const svg = getByRole('button').querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('rotate-90'); // expanded
    fireEvent.click(getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <ListFocusGroupHeader
        groupKey="doing"
        label="Doing"
        count={1}
        collapsed={true}
        onToggle={onToggle}
      />,
    );
    expect(svg.getAttribute('class')).not.toContain('rotate-90'); // collapsed
  });

  it('shows the ticket count (pass 8)', () => {
    const { getByText } = render(
      <ListFocusGroupHeader
        groupKey="doing"
        label="Doing"
        count={7}
        collapsed={false}
        onToggle={() => {}}
      />,
    );
    expect(getByText('7')).not.toBeNull();
  });
});
