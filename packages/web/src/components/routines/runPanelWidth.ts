/**
 * Geometry of the History slide-over.
 *
 * The panel overlays the run listing rather than sitting beside it, so its
 * width is bounded by the area it covers and not by a remaining-space
 * calculation: dragging past the left edge would otherwise let it grow wider
 * than the pane it lives in and spill over the app chrome.
 */

/** Below this the run DAG is unreadable — the drag stops rather than shrinking further. */
export const MIN_PANEL_WIDTH = 360;

/** Opened wide on purpose: the whole point is to escape the cramped inline card. */
export const DEFAULT_PANEL_RATIO = 0.8;

/**
 * Keeps a dragged width inside its container. A container narrower than
 * MIN_PANEL_WIDTH still gets a panel — full width — instead of one hanging out
 * of view.
 */
export function clampPanelWidth(desired: number, containerWidth: number): number {
  const min = Math.min(MIN_PANEL_WIDTH, containerWidth);
  return Math.max(min, Math.min(desired, containerWidth));
}

/** The width a freshly opened panel takes: ~80% of the listing it covers. */
export function defaultPanelWidth(containerWidth: number): number {
  return clampPanelWidth(Math.round(containerWidth * DEFAULT_PANEL_RATIO), containerWidth);
}
