import { afterEach, describe, expect, it } from 'vitest';
import { viewportPadding } from './usePopover';

describe('viewportPadding', () => {
  afterEach(() => { document.getElementById('fleex-desktop-titlebar')?.remove(); });

  it('keeps an 8 px margin on every edge in a browser (no title bar)', () => {
    expect(viewportPadding()).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  });

  // In the desktop app the Electron title bar is drawn over the page: a popover
  // clamped to the top edge would slide under it and hide its title.
  it('starts the top edge below the Electron title bar', () => {
    const bar = document.createElement('div');
    bar.id = 'fleex-desktop-titlebar';
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 40, left: 0, right: 1000, width: 1000, height: 40, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(bar);
    expect(viewportPadding().top).toBe(48);
    expect(viewportPadding().bottom).toBe(8);
  });
});
