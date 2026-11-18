import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FactoryBuildFrame } from './FactoryBuildFrame';

describe('<FactoryBuildFrame/>', () => {
  it('says the page is in build mode, and that the floor keeps running under it', () => {
    render(<FactoryBuildFrame halted={false} />);
    const frame = screen.getByRole('status', { name: 'Build mode' });
    expect(frame.textContent).toContain('BUILD MODE');
    expect(frame.textContent).toContain('the floor keeps running');
    /* it is drawn over the floor and must leave it to the pointer: edges, drags and clicks go through */
    expect(frame.className).toContain('pointer-events-none');
  });

  it('does not say the floor runs while the emergency stop is on', () => {
    render(<FactoryBuildFrame halted />);
    const frame = screen.getByRole('status', { name: 'Build mode' });
    expect(frame.textContent).toContain('the floor is stopped');
    expect(frame.textContent).not.toContain('keeps running');
  });
});
