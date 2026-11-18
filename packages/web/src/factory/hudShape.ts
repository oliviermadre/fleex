/**
 * The shape of the console: its two side blocks (the minimap, the command card) stand taller than its middle, and
 * their inner top corners are cut. The floor shows in the notch between them. Whatever follows the console's
 * contour (the build tape) reads it from here.
 */
export const HUD = {
  /** How wide the block of the minimap and the block of the command card are. */
  left: 358, right: 392,
  /** How tall the middle is, and how much taller the two side blocks stand. */
  mid: 190, step: 72,
  /** How much is cut off the inner top corner of each side block. */
  cut: 30,
} as const;
export type HudShape = typeof HUD;
