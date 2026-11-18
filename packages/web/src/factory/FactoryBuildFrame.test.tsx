import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FactoryBuildFrame, tapeShape } from './FactoryBuildFrame';
import { HUD } from './hudShape';

describe('<FactoryBuildFrame/>', () => {
  it('says the page is in build mode, and that the floor keeps running under it', () => {
    render(<FactoryBuildFrame halted={false} />);
    const frame = screen.getByRole('status', { name: 'Build mode' });
    expect(frame.textContent).toContain('BUILD MODE');
    expect(frame.textContent).toContain('the floor keeps running');
    /* it is drawn over the floor and must leave it to the pointer: edges, drags and clicks go through */
    expect(frame.className).toContain('pointer-events-none');
  });

  it('is a plain frame with the console put away, and follows the console\'s contour when it is shown', () => {
    const { rerender, container } = render(<FactoryBuildFrame halted={false} />);
    expect(container.querySelector('[data-tape]')!.getAttribute('data-tape')).toBe('frame');
    rerender(<FactoryBuildFrame halted={false} hud={HUD} />);
    expect(container.querySelector('[data-tape]')!.getAttribute('data-tape')).toBe('contour');
    /* a ring: an outer line and an inner one, four corners each for a frame, ten for the contour (two steps, two cut corners) */
    const points = (shape: string) => shape.slice(shape.indexOf(',') + 1, -1).split(', ').length;
    expect(points(tapeShape(null))).toBe(4 + 1 + 4 + 1);
    expect(points(tapeShape(HUD))).toBe(10 + 1 + 10 + 1);
    /* the foot of the tape lies on the middle of the console, between its two side blocks, and steps up over them */
    const shape = tapeShape(HUD);
    expect(shape).toContain(`${HUD.left}px 100%`);
    expect(shape).toContain(`calc(100% - ${HUD.right}px) 100%`);
    expect(shape).toContain(`0 calc(100% - ${HUD.step}px)`);
    expect(shape).toContain(`${HUD.left - HUD.cut}px calc(100% - ${HUD.step}px)`);  // where the left block's corner is cut
  });

  it('does not say the floor runs while the emergency stop is on', () => {
    render(<FactoryBuildFrame halted />);
    const frame = screen.getByRole('status', { name: 'Build mode' });
    expect(frame.textContent).toContain('the floor is stopped');
    expect(frame.textContent).not.toContain('keeps running');
  });
});
