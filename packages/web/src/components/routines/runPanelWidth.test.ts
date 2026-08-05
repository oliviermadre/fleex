import { describe, it, expect } from 'vitest';
import { clampPanelWidth, defaultPanelWidth, MIN_PANEL_WIDTH } from './runPanelWidth';

describe('clampPanelWidth', () => {
  it('stops the drag at the container edge', () => {
    // Dragging the handle past the left edge of the listing would otherwise
    // make the overlay wider than the pane it covers.
    expect(clampPanelWidth(1400, 1000)).toBe(1000);
  });

  it('refuses to shrink the panel below a readable DAG width', () => {
    expect(clampPanelWidth(120, 1000)).toBe(MIN_PANEL_WIDTH);
  });

  it('gives the whole width when the pane is narrower than the minimum', () => {
    // A split view can leave less than MIN_PANEL_WIDTH; clamping to the
    // minimum there would push the close button out of view.
    expect(clampPanelWidth(300, 280)).toBe(280);
  });
});

describe('defaultPanelWidth', () => {
  it('opens over most of the listing, not beside it', () => {
    // The complaint this replaces was "on se sent tout étriqué" — a panel that
    // opens narrow would reproduce it.
    expect(defaultPanelWidth(1000)).toBe(800);
  });
});
