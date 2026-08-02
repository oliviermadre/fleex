/**
 * Position registry for spatial keyboard navigation between floating overlays.
 *
 * Lives in its own module so useKeyboardShortcuts (which runs on every page
 * load) can read it without statically importing FloatingSessionOverlay, whose
 * chunk carries @xterm/xterm.
 */
export const floatingPositionRegistry = new Map<
  string,
  { x: number; y: number; width: number; height: number }
>();
