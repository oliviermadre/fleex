import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { FactoryHudShadow, hudShadowShape } from './FactoryHudShadow';
import { HUD } from './hudShape';

afterEach(() => document.documentElement.style.removeProperty('--theme-bg-surface'));

describe('the shadow of the console', () => {
  it('follows the console\'s contour: the tops of the two side blocks, their cut corners, and the foot of the view between them', () => {
    const shape = hudShadowShape(HUD);
    expect(shape).toContain(`0 calc(100% - ${HUD.step}px)`);
    expect(shape).toContain(`${HUD.left - HUD.cut}px calc(100% - ${HUD.step}px)`);
    expect(shape).toContain(`${HUD.left}px 100%`);
    expect(shape).toContain(`calc(100% - ${HUD.right}px) 100%`);
    expect(shape.slice(8, -1).split(', ')).toHaveLength(10);
  });

  it('takes no pointer event, and is deep on a dark floor and light on a light one', async () => {
    const { container } = render(<FactoryHudShadow hud={HUD} />);
    const shadow = container.querySelector('[data-hud-shadow]') as HTMLElement;
    expect(shadow.className).toContain('pointer-events-none');
    expect(shadow.getAttribute('data-hud-shadow')).toBe('dark');
    const deep = Number(shadow.style.opacity);
    /* a theme is applied by setting its colours on the root element: the shadow follows */
    await act(async () => { document.documentElement.style.setProperty('--theme-bg-surface', '#ffffff'); await new Promise((r) => setTimeout(r, 0)); });
    expect(shadow.getAttribute('data-hud-shadow')).toBe('light');
    expect(Number(shadow.style.opacity)).toBeLessThan(deep);
  });
});
